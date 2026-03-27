import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { sendFotInviteEmail } from "@/lib/email/fot-invite";
import { createServiceRoleClient } from "@/lib/supabase/service";

type Payload = {
  memberIds?: number[];
  baseUrl?: string;
  path?: string;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  email: string | null;
};

type ActiveTokenRow = {
  memberid: number | string | null;
  tokenhash: string | null;
};

function normalizeBaseUrl(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as Payload))) ?? {};
  const memberIds = Array.isArray(payload.memberIds)
    ? (payload.memberIds as unknown[])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];

  if (!memberIds.length) {
    return NextResponse.json({ error: "No member ids provided." }, { status: 400 });
  }

  const baseUrl =
    normalizeBaseUrl(payload.baseUrl) ||
    normalizeBaseUrl(request.headers.get("origin")) ||
    normalizeBaseUrl(request.nextUrl.origin);
  const path = String(payload.path ?? "/fot-reg/register").trim() || "/fot-reg/register";

  const supabase = createServiceRoleClient();
  const currentYear = new Date().getFullYear();
  const { data: memberData, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,fname,lname,email")
    .eq("statusid", 1)
    .eq("baptized", true)
    .in("id", memberIds)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true });

  if (memberErr) {
    return NextResponse.json({ error: `Failed to load members: ${memberErr.message}` }, { status: 500 });
  }

  const members = ((memberData ?? []) as MemberRow[]).filter((m) => String(m.email ?? "").trim().length > 0);
  if (!members.length) {
    return NextResponse.json({ error: "No eligible members with email found for the selected list." }, { status: 400 });
  }

  const memberIdsSet = members.map((m) => m.id);
  const { data: tokenData, error: tokenErr } = await supabase
    .from("fotregtoken")
    .select("memberid,tokenhash")
    .eq("isactive", true)
    .in("memberid", memberIdsSet);
  if (tokenErr) {
    return NextResponse.json(
      { error: `Failed to load active FoT registration links: ${tokenErr.message}` },
      { status: 500 },
    );
  }

  const tokenHashByMemberId = ((tokenData ?? []) as ActiveTokenRow[]).reduce<Record<number, string>>(
    (acc, row) => {
      const memberId = Number(row.memberid ?? 0);
      const tokenHash = String(row.tokenhash ?? "").trim();
      if (!Number.isFinite(memberId) || memberId <= 0 || !tokenHash) return acc;
      acc[memberId] = tokenHash;
      return acc;
    },
    {},
  );

  const emailResults = {
    attempted: 0,
    sent: 0,
    failed: [] as Array<{ memberId: number; email: string; error: string }>,
  };

  for (const member of members) {
    emailResults.attempted += 1;
    const tokenHash = tokenHashByMemberId[member.id] ?? "";
    if (!tokenHash) {
      emailResults.failed.push({
        memberId: member.id,
        email: String(member.email ?? "").trim(),
        error: "No active FoT registration link found for this member. Make sure that person is in fellowship and baptized.",
      });
      continue;
    }

    const link = `${baseUrl}${path}?t=${encodeURIComponent(tokenHash)}`;

    try {
      await sendFotInviteEmail({
        to: String(member.email ?? "").trim(),
        firstName: String(member.fname ?? "").trim(),
        lastName: String(member.lname ?? "").trim(),
        link,
        year: currentYear,
      });
      emailResults.sent += 1;
    } catch (err) {
      emailResults.failed.push({
        memberId: member.id,
        email: String(member.email ?? "").trim(),
        error: err instanceof Error ? err.message : "Unknown email send error",
      });
    }
  }

  return NextResponse.json({
    selectedCount: memberIds.length,
    eligibleCount: members.length,
    emailResults,
  });
}
