import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createFotToken, hashFotToken } from "@/lib/fot/tokens";

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

type ExistingTokenRow = {
  memberid: number | string | null;
};

function normalizeBaseUrl(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as Payload))) ?? {};
  const requestedMemberIds = Array.isArray(payload.memberIds)
    ? payload.memberIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];

  const baseUrl =
    normalizeBaseUrl(payload.baseUrl) ||
    normalizeBaseUrl(request.headers.get("origin")) ||
    normalizeBaseUrl(request.nextUrl.origin);
  const path = String(payload.path ?? "/fot-reg/register").trim() || "/fot-reg/register";

  const supabase = createServiceRoleClient();

  let memberQuery = supabase
    .from("emcmember")
    .select("id,fname,lname,email")
    .eq("statusid", 1)
    .eq("baptized", true)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true });

  if (requestedMemberIds.length > 0) {
    memberQuery = memberQuery.in("id", requestedMemberIds);
  }

  const { data: memberData, error: memberErr } = await memberQuery;
  if (memberErr) {
    return NextResponse.json({ error: `Failed to load members: ${memberErr.message}` }, { status: 500 });
  }

  const members = ((memberData ?? []) as MemberRow[]).filter((m) => String(m.email ?? "").trim().length > 0);
  if (!members.length) {
    return NextResponse.json({ links: [] });
  }

  const memberIds = members.map((m) => m.id);
  const { data: existingTokenData, error: existingTokenErr } = await supabase
    .from("fotregtoken")
    .select("memberid")
    .eq("isactive", true)
    .in("memberid", memberIds);
  if (existingTokenErr) {
    return NextResponse.json(
      { error: `Failed to load existing active FoT registration links: ${existingTokenErr.message}` },
      { status: 500 },
    );
  }

  const activeTokenMemberIds = new Set(
    ((existingTokenData ?? []) as ExistingTokenRow[])
      .map((row) => Number(row.memberid))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  const links: Array<{
    memberId: number;
    firstName: string;
    lastName: string;
    email: string;
    link: string;
  }> = [];
  const skippedExisting: Array<{
    memberId: number;
    firstName: string;
    lastName: string;
    email: string;
    reason: string;
  }> = [];

  for (const member of members) {
    if (activeTokenMemberIds.has(member.id)) {
      skippedExisting.push({
        memberId: member.id,
        firstName: String(member.fname ?? "").trim(),
        lastName: String(member.lname ?? "").trim(),
        email: String(member.email ?? "").trim(),
        reason: "active FoT registration link already exists",
      });
      continue;
    }

    const token = createFotToken();
    const tokenHash = hashFotToken(token);
    const { error: insErr } = await supabase.from("fotregtoken").insert({
      memberid: member.id,
      tokenhash: tokenHash,
      isactive: true,
    });
    if (insErr) {
      return NextResponse.json(
        { error: `Failed to create FoT registration link for member ${member.id}: ${insErr.message}` },
        { status: 500 },
      );
    }

    links.push({
      memberId: member.id,
      firstName: String(member.fname ?? "").trim(),
      lastName: String(member.lname ?? "").trim(),
      email: String(member.email ?? "").trim(),
      link: `${baseUrl}${path}?t=${encodeURIComponent(token)}`,
    });
  }

  return NextResponse.json({
    count: links.length,
    links,
    skippedCount: skippedExisting.length,
    skippedExisting,
  });
}
