import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireRole } from "@/lib/authz";

type EnsureAccountPayload = {
  memberId?: number;
};

type DeactivateAccountPayload = {
  memberId?: number;
};

type SetRolePayload = {
  memberId?: number;
  roleName?: string;
  emcRoleName?: string | null;
  contribRoleName?: string | null;
};

type AccountRow = {
  id: number;
  memberid: number | null;
  isactive: boolean | null;
};

type AccountRoleWithAccountId = {
  accountid: number | null;
  emcroles?: { rolename?: string | null } | { rolename?: string | null }[] | null;
};

type EnsureAccountResult = {
  accountId: number | null;
  error: string | null;
  sent?: "invite" | "reset";
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

function highestAccessRoleName(
  roleNames: string[],
): "emc_admin" | "emc_superuser" | "emc_user" | null {
  if (roleNames.includes("emc_admin")) return "emc_admin";
  if (roleNames.includes("emc_superuser")) return "emc_superuser";
  if (roleNames.includes("emc_user")) return "emc_user";
  return null;
}

function highestContribAccessRoleName(
  roleNames: string[],
): "contrib_admin" | "contrib_user" | null {
  if (roleNames.includes("contrib_admin")) return "contrib_admin";
  if (roleNames.includes("contrib_user")) return "contrib_user";
  return null;
}

async function ensureActiveAccountForMember(
  supabase: ReturnType<typeof createServiceRoleClient>,
  request: NextRequest,
  memberId: number,
): Promise<EnsureAccountResult> {
  const appOrigin = resolveAppOrigin(request);

  const { data: member, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,email")
    .eq("id", memberId)
    .maybeSingle();

  if (memberErr) {
    return { accountId: null, error: memberErr.message };
  }
  const memberEmail = String(member?.email ?? "").trim().toLowerCase();
  if (!memberEmail) {
    return { accountId: null, error: "Selected member does not have an email address." };
  }

  let accountId: number | null = null;
  let authUserId: string | null = null;
  let usedExistingAuthUser = false;
  let sent: "invite" | "reset" | undefined;

  const { data: existingAccount, error: existingErr } = await supabase
    .from("emcaccounts")
    .select("id, isactive, authuserid")
    .eq("memberid", memberId)
    .maybeSingle();

  if (existingErr) {
    return { accountId: null, error: existingErr.message };
  }

  if (existingAccount?.id) {
    accountId = existingAccount.id as number;
    authUserId = String(existingAccount.authuserid ?? "").trim() || null;
    if (authUserId) {
      const { data: linkedAuthData } = await supabase.auth.admin.getUserById(authUserId);
      const linkedAuthEmail = String(linkedAuthData?.user?.email ?? "")
        .trim()
        .toLowerCase();
      if (!linkedAuthEmail || linkedAuthEmail !== memberEmail) {
        authUserId = null;
      }
      if (authUserId) {
        usedExistingAuthUser = true;
      }
    }
    if (!existingAccount.isactive) {
      const { error: reactivateErr } = await supabase
        .from("emcaccounts")
        .update({ isactive: true })
        .eq("id", accountId);
      if (reactivateErr) {
        return { accountId: null, error: reactivateErr.message };
      }
    }
  }

  let existingAuthResult: { id: string | null; error: { message: string } | null } | null = null;

  if (!authUserId) {
    existingAuthResult = await findAuthUserIdByEmail(supabase, memberEmail);
    if (existingAuthResult.error) {
      return { accountId: null, error: existingAuthResult.error.message };
    }

    if (existingAuthResult.id) {
      authUserId = existingAuthResult.id;
      usedExistingAuthUser = true;
    } else {
      const redirectTo = `${appOrigin}/auth/callback?next=/reset-password`;
      const { data: inviteData, error: inviteErr } =
        await supabase.auth.admin.inviteUserByEmail(memberEmail, { redirectTo });
      if (inviteErr || !inviteData.user?.id) {
        return {
          accountId: null,
          error: inviteErr?.message ?? "Failed to create auth user from member email.",
        };
      }
      authUserId = inviteData.user.id;
      sent = "invite";
    }
  }

  if (!accountId) {
    const { data: created, error: createErr } = await supabase
      .from("emcaccounts")
      .insert({ memberid: memberId, authuserid: authUserId, isactive: true })
      .select("id")
      .single();

    if (createErr || !created?.id) {
      return { accountId: null, error: createErr?.message ?? "Failed to create account." };
    }
    accountId = created.id as number;
  } else {
    const { error: accountUpdateErr } = await supabase
      .from("emcaccounts")
      .update({ authuserid: authUserId, isactive: true })
      .eq("id", accountId);
    if (accountUpdateErr) {
      return { accountId: null, error: accountUpdateErr.message };
    }
  }

  // Existing auth user: send reset; brand-new user already received invite above.
  if (authUserId && usedExistingAuthUser) {
    const redirectTo = `${appOrigin}/auth/callback?next=/reset-password`;
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(memberEmail, {
      redirectTo,
    });
    if (resetErr) {
      return { accountId: null, error: resetErr.message };
    }
    sent = sent ?? "reset";
  }

  return { accountId, error: null, sent };
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as EnsureAccountPayload))) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: userRole, error: userRoleErr } = await supabase
    .from("emcroles")
    .select("id")
    .eq("rolename", "emc_user")
    .maybeSingle();

  if (userRoleErr || !userRole?.id) {
    return NextResponse.json({ error: "Role emc_user was not found." }, { status: 500 });
  }

  const ensured = await ensureActiveAccountForMember(supabase, request, memberId);
  if (ensured.error || !ensured.accountId) {
    return NextResponse.json({ error: ensured.error ?? "Failed to ensure account." }, { status: 500 });
  }
  const accountId = ensured.accountId;
  const sent = ensured.sent ?? null;
  const sent = ensured.sent ?? null;
  const sent = ensured.sent ?? null;
  const sent = ensured.sent ?? null;

  const { data: existingRole, error: roleLookupErr } = await supabase
    .from("emcaccountroles")
    .select("accountid")
    .eq("accountid", accountId)
    .eq("roleid", userRole.id)
    .maybeSingle();

  if (roleLookupErr) {
    return NextResponse.json({ error: roleLookupErr.message }, { status: 500 });
  }

  if (!existingRole) {
    const { error: roleInsertErr } = await supabase
      .from("emcaccountroles")
      .insert({ accountid: accountId, roleid: userRole.id });
    if (roleInsertErr) {
      return NextResponse.json({ error: roleInsertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, accountId });
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const memberIdParam = request.nextUrl.searchParams.get("memberId");
  const memberIdsParam = request.nextUrl.searchParams.get("memberIds");

  const memberIds = (
    memberIdParam
      ? [memberIdParam]
      : (memberIdsParam ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
  )
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (memberIds.length === 0) {
    return NextResponse.json({ error: "Missing member id(s)." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: accountRows, error: accountErr } = await supabase
    .from("emcaccounts")
    .select("id,memberid,isactive")
    .in("memberid", memberIds)
    .order("id", { ascending: false });

  if (accountErr) {
    return NextResponse.json({ error: accountErr.message }, { status: 500 });
  }

  const activeAccountsByMemberId = new Map<number, number>();
  ((accountRows ?? []) as AccountRow[]).forEach((row) => {
    if (!row.memberid || !row.isactive) return;
    if (!activeAccountsByMemberId.has(row.memberid)) {
      activeAccountsByMemberId.set(row.memberid, row.id);
    }
  });

  const accountIds = Array.from(activeAccountsByMemberId.values());
  const rolesByAccountId = new Map<number, string[]>();

  if (accountIds.length > 0) {
    const { data: roleRows, error: roleErr } = await supabase
      .from("emcaccountroles")
      .select("accountid,emcroles(rolename)")
      .in("accountid", accountIds);

    if (roleErr) {
      return NextResponse.json({ error: roleErr.message }, { status: 500 });
    }

    ((roleRows ?? []) as AccountRoleWithAccountId[]).forEach((row) => {
      if (!row.accountid) return;
      const roleEntry = Array.isArray(row.emcroles)
        ? row.emcroles[0] ?? null
        : row.emcroles ?? null;
      const roleName = String(roleEntry?.rolename ?? "").trim();
      if (!roleName) return;
      const current = rolesByAccountId.get(row.accountid) ?? [];
      current.push(roleName);
      rolesByAccountId.set(row.accountid, current);
    });
  }

  const accessByMemberId: Record<number, "emc_admin" | "emc_superuser" | "emc_user" | null> = {};
  const contribAccessByMemberId: Record<number, "contrib_admin" | "contrib_user" | null> = {};
  memberIds.forEach((memberId) => {
    const accountId = activeAccountsByMemberId.get(memberId);
    if (!accountId) {
      accessByMemberId[memberId] = null;
      contribAccessByMemberId[memberId] = null;
      return;
    }
    const accountRoleNames = rolesByAccountId.get(accountId) ?? [];
    accessByMemberId[memberId] = highestAccessRoleName(accountRoleNames);
    contribAccessByMemberId[memberId] = highestContribAccessRoleName(accountRoleNames);
  });

  return NextResponse.json({ accessByMemberId, contribAccessByMemberId });
}

export async function PUT(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as SetRolePayload))) ?? {};
  const memberId = Number(payload.memberId);
  const legacyRoleName = String(payload.roleName ?? "").trim().toLowerCase();
  const emcRoleName = String(payload.emcRoleName ?? legacyRoleName ?? "").trim().toLowerCase();
  const contribRoleName = String(payload.contribRoleName ?? "").trim().toLowerCase();
  const hasLegacyRoleField = Object.prototype.hasOwnProperty.call(payload, "roleName");
  const hasEmcRoleField = Object.prototype.hasOwnProperty.call(payload, "emcRoleName");
  const hasContribRoleField = Object.prototype.hasOwnProperty.call(payload, "contribRoleName");
  const updateEmcRole = hasLegacyRoleField || hasEmcRoleField;
  const updateContribRole = hasContribRoleField;
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  if (
    emcRoleName &&
    !["emc_admin", "emc_superuser", "emc_user"].includes(emcRoleName)
  ) {
    return NextResponse.json({ error: "Invalid EMC role name." }, { status: 400 });
  }
  if (contribRoleName && !["contrib_admin", "contrib_user"].includes(contribRoleName)) {
    return NextResponse.json({ error: "Invalid Contributions role name." }, { status: 400 });
  }

  if (!updateEmcRole && !updateContribRole) {
    return NextResponse.json({ error: "Missing role update payload." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const ensured = await ensureActiveAccountForMember(supabase, request, memberId);
  if (ensured.error || !ensured.accountId) {
    return NextResponse.json({ error: ensured.error ?? "Failed to ensure account." }, { status: 500 });
  }
  const accountId = ensured.accountId;

  const roleNamesToResolve = [
    "emc_admin",
    "emc_superuser",
    "emc_user",
    "contrib_admin",
    "contrib_user",
  ] as const;
  const { data: roleRows, error: roleErr } = await supabase
    .from("emcroles")
    .select("id,rolename")
    .in("rolename", [...roleNamesToResolve]);

  if (roleErr) {
    return NextResponse.json({ error: roleErr.message }, { status: 500 });
  }

  const roleIdByName = new Map<string, number>();
  (roleRows ?? []).forEach((row) => {
    const name = String(row.rolename ?? "").trim().toLowerCase();
    const id = Number(row.id);
    if (!name || !Number.isFinite(id) || id <= 0) return;
    roleIdByName.set(name, id);
  });

  if (emcRoleName && !roleIdByName.has(emcRoleName)) {
    return NextResponse.json({ error: `Role ${emcRoleName} was not found.` }, { status: 500 });
  }
  if (contribRoleName && !roleIdByName.has(contribRoleName)) {
    return NextResponse.json({ error: `Role ${contribRoleName} was not found.` }, { status: 500 });
  }

  const managedRoleIds: number[] = [];
  if (updateEmcRole) {
    ["emc_admin", "emc_superuser", "emc_user"].forEach((name) => {
      const id = roleIdByName.get(name);
      if (id) managedRoleIds.push(id);
    });
  }
  if (updateContribRole) {
    ["contrib_admin", "contrib_user"].forEach((name) => {
      const id = roleIdByName.get(name);
      if (id) managedRoleIds.push(id);
    });
  }

  const { error: deleteErr } = await supabase
    .from("emcaccountroles")
    .delete()
    .eq("accountid", accountId)
    .in("roleid", managedRoleIds);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  const rowsToInsert: Array<{ accountid: number; roleid: number }> = [];
  if (updateEmcRole && emcRoleName) {
    rowsToInsert.push({
      accountid: accountId,
      roleid: roleIdByName.get(emcRoleName)!,
    });
  }
  if (updateContribRole && contribRoleName) {
    rowsToInsert.push({
      accountid: accountId,
      roleid: roleIdByName.get(contribRoleName)!,
    });
  }

  if (rowsToInsert.length > 0) {
    const { error: insertErr } = await supabase
      .from("emcaccountroles")
      .insert(rowsToInsert);
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    accountId,
    emcRoleName: emcRoleName || null,
    contribRoleName: contribRoleName || null,
    sent,
  });
}

export async function PATCH(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload =
    (await request.json().catch(() => ({} as DeactivateAccountPayload))) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("emcaccounts")
    .update({ isactive: false })
    .eq("memberid", memberId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
