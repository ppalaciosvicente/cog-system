import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createFotToken, hashFotToken } from "@/lib/fot/tokens";
import { sendFotInviteEmail } from "@/lib/email/fot-invite";

type Payload = {
  baseUrl?: string;
  path?: string;
  sendEmails?: boolean;
  dryRun?: boolean;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  email: string | null;
};

type PreviewWithEmailRow = {
  memberId: number;
  firstName: string;
  lastName: string;
  email: string;
};

type PreviewMissingEmailRow = {
  memberId: number;
  firstName: string;
  lastName: string;
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
  const sendEmails = Boolean(payload.sendEmails);
  const dryRun = Boolean(payload.dryRun);
  const baseUrl =
    normalizeBaseUrl(payload.baseUrl) ||
    normalizeBaseUrl(request.headers.get("origin")) ||
    normalizeBaseUrl(request.nextUrl.origin);
  const path = String(payload.path ?? "/fot-reg/register").trim() || "/fot-reg/register";

  const supabase = createServiceRoleClient();

  const { data: memberData, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,fname,lname,email")
    .eq("statusid", 1)
    .eq("baptized", true)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true });

  if (memberErr) {
    return NextResponse.json({ error: `Failed to load members: ${memberErr.message}` }, { status: 500 });
  }

  const allMembers = (memberData ?? []) as MemberRow[];
  const members = allMembers.filter((m) => String(m.email ?? "").trim().length > 0);
  const missingEmailMembers = allMembers.filter((m) => !String(m.email ?? "").trim().length);
  const withoutEmailCount = missingEmailMembers.length;

  if (dryRun) {
    const previewWithEmail: PreviewWithEmailRow[] = members.map((m) => ({
      memberId: m.id,
      firstName: String(m.fname ?? "").trim(),
      lastName: String(m.lname ?? "").trim(),
      email: String(m.email ?? "").trim(),
    }));

    const previewMissingEmail: PreviewMissingEmailRow[] = missingEmailMembers.map((m) => ({
      memberId: m.id,
      firstName: String(m.fname ?? "").trim(),
      lastName: String(m.lname ?? "").trim(),
    }));

    return NextResponse.json({
      dryRun: true,
      count: members.length,
      links: [] as Array<{
        memberId: number;
        firstName: string;
        lastName: string;
        email: string;
        link: string;
      }>,
      withoutEmailCount,
      previewWithEmail,
      previewMissingEmail,
      emailResults: {
        attempted: sendEmails ? members.length : 0,
        sent: 0,
        failed: [] as Array<{ memberId: number; email: string; error: string }>,
      },
    });
  }

  const { error: deleteIndividualsErr } = await supabase
    .from("fotregindividual")
    .delete()
    .not("id", "is", null);
  if (deleteIndividualsErr) {
    return NextResponse.json(
      { error: `Failed to flush fotregindividual: ${deleteIndividualsErr.message}` },
      { status: 500 },
    );
  }

  const { error: deleteRegsErr } = await supabase.from("fotreg").delete().not("id", "is", null);
  if (deleteRegsErr) {
    return NextResponse.json(
      { error: `Failed to flush fotreg: ${deleteRegsErr.message}` },
      { status: 500 },
    );
  }

  const { error: deleteTokensErr } = await supabase.from("fotregtoken").delete().not("id", "is", null);
  if (deleteTokensErr) {
    return NextResponse.json(
      { error: `Failed to flush fotregtoken: ${deleteTokensErr.message}` },
      { status: 500 },
    );
  }

  const links: Array<{
    memberId: number;
    firstName: string;
    lastName: string;
    email: string;
    link: string;
  }> = [];

  for (const member of members) {
    const token = createFotToken();
    const tokenHash = hashFotToken(token);

    const { error: insErr } = await supabase.from("fotregtoken").insert({
      memberid: member.id,
      tokenhash: tokenHash,
      isactive: true,
    });

    if (insErr) {
      return NextResponse.json(
        { error: `Failed to create token for member ${member.id}: ${insErr.message}` },
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

  const emailResults = {
    attempted: 0,
    sent: 0,
    failed: [] as Array<{ memberId: number; email: string; error: string }>,
  };

  if (sendEmails) {
    for (const row of links) {
      emailResults.attempted += 1;
      try {
        await sendFotInviteEmail({
          to: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          link: row.link,
          year: 2026,
        });
        emailResults.sent += 1;
      } catch (err) {
        emailResults.failed.push({
          memberId: row.memberId,
          email: row.email,
          error: err instanceof Error ? err.message : "Unknown email send error",
        });
      }
    }
  }

  return NextResponse.json({
    dryRun: false,
    count: links.length,
    links,
    withoutEmailCount,
    emailResults,
  });
}
