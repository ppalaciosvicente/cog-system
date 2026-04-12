import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { RoleRow } from "@/types/roles";
import { normalizeRoleRow } from "@/types/roles";

type Payload = {
  memberId?: number;
};

function resolveAppOrigin(request: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  return request.nextUrl.origin;
}

async function findAuthUserIdByEmail(
  supabase: ReturnType<typeof createServiceRoleClient>,
  email: string,
) {
  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) return { id: null as string | null, error };

    const users = data?.users ?? [];
    const match = users.find(
      (u) => String(u.email ?? "").trim().toLowerCase() === target,
    );
    if (match?.id) return { id: match.id, error: null };

    const reachedEnd = users.length < perPage;
    if (reachedEnd) break;
    page += 1;
  }

  return { id: null as string | null, error: null };
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as Payload))) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const appOrigin = resolveAppOrigin(request);

  const { data: member, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,email,fname,lname")
    .eq("id", memberId)
    .maybeSingle();

  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  if (!member?.id) {
    return NextResponse.json({ error: "Member was not found." }, { status: 404 });
  }

  const memberEmail = String(member.email ?? "").trim().toLowerCase();
  if (!memberEmail) {
    return NextResponse.json(
      { error: "This elder does not have an email address." },
      { status: 400 },
    );
  }

  const { data: accountRows, error: accountErr } = await supabase
    .from("emcaccounts")
    .select("id,authuserid,isactive")
    .eq("memberid", memberId)
    .eq("isactive", true)
    .order("id", { ascending: false })
    .limit(1);

  if (accountErr) {
    return NextResponse.json({ error: accountErr.message }, { status: 500 });
  }
  const account = (accountRows ?? [])[0] as
    | { id: number; authuserid: string | null; isactive: boolean | null }
    | undefined;
  if (!account?.id) {
    return NextResponse.json(
      { error: "This elder has no EMC role assigned." },
      { status: 400 },
    );
  }

  const { data: roleRows, error: roleErr } = await supabase
    .from("emcaccountroles")
    .select("emcroles(rolename)")
    .eq("accountid", account.id);
  if (roleErr) {
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  const roleNames =
    (roleRows ?? [])
      .map((row: RoleRow) => normalizeRoleRow(row)?.rolename)
      .filter((value): value is string => Boolean(value)) ?? [];
  const hasAccessRole = roleNames.some((name) =>
    ["emc_admin", "emc_superuser", "emc_user", "contrib_admin", "contrib_user"].includes(name),
  );
  if (!hasAccessRole) {
    return NextResponse.json(
      { error: "This elder has no EMC/Contributions access assigned." },
      { status: 400 },
    );
  }

  let authUserId = String(account.authuserid ?? "").trim() || null;
  let usedExistingAuthUser = Boolean(authUserId);
  if (authUserId) {
    const { data: linkedAuthData } = await supabase.auth.admin.getUserById(authUserId);
    const linkedAuthEmail = String(linkedAuthData?.user?.email ?? "")
      .trim()
      .toLowerCase();
    if (!linkedAuthEmail || linkedAuthEmail !== memberEmail) {
      authUserId = null;
      usedExistingAuthUser = false;
    }
  }

  if (!authUserId) {
    const existingAuth = await findAuthUserIdByEmail(supabase, memberEmail);
    if (existingAuth.error) {
      return NextResponse.json({ error: existingAuth.error.message }, { status: 500 });
    }
    authUserId = existingAuth.id;
    usedExistingAuthUser = Boolean(authUserId);
    if (!authUserId) {
      const { data: inviteData, error: inviteErr } =
        await supabase.auth.admin.inviteUserByEmail(memberEmail, {
          redirectTo: `${appOrigin}/auth/callback?next=/reset-password`,
        });
      if (inviteErr || !inviteData.user?.id) {
        return NextResponse.json(
          { error: inviteErr?.message ?? "Failed to create auth user." },
          { status: 500 },
        );
      }
      authUserId = inviteData.user.id;
      usedExistingAuthUser = false;
    }
  }

  const redirectTo = `${appOrigin}/auth/callback?next=/reset-password`;

  const { error: accountUpdateErr } = await supabase
    .from("emcaccounts")
    .update({ authuserid: authUserId, isactive: true })
    .eq("id", account.id);
  if (accountUpdateErr) {
    return NextResponse.json({ error: accountUpdateErr.message }, { status: 500 });
  }

  if (usedExistingAuthUser) {
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(memberEmail, {
      redirectTo,
    });
    if (resetErr) {
      return NextResponse.json({ error: resetErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sent: "reset" as const });
  }

  return NextResponse.json({ ok: true, sent: "invite" as const });
}
