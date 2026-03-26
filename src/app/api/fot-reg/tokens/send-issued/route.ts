import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { sendFotInviteEmail } from "@/lib/email/fot-invite";

type InviteRow = {
  memberId: number;
  firstName: string;
  lastName: string;
  email: string;
  link: string;
};

type Payload = {
  invites?: InviteRow[];
};

function normalizeInvite(raw: unknown): InviteRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const memberId = Number(row.memberId);
  const firstName = String(row.firstName ?? "").trim();
  const lastName = String(row.lastName ?? "").trim();
  const email = String(row.email ?? "").trim();
  const link = String(row.link ?? "").trim();

  if (!Number.isFinite(memberId) || memberId <= 0) return null;
  if (!email || !link) return null;
  return { memberId, firstName, lastName, email, link };
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as Payload))) ?? {};
  const invites = Array.isArray(payload.invites)
    ? payload.invites.map((row) => normalizeInvite(row)).filter((row): row is InviteRow => Boolean(row))
    : [];

  if (!invites.length) {
    return NextResponse.json({ error: "No valid issued invites were provided." }, { status: 400 });
  }

  const emailResults = {
    attempted: 0,
    sent: 0,
    failed: [] as Array<{ memberId: number; email: string; error: string }>,
  };

  for (const row of invites) {
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

  return NextResponse.json({ emailResults });
}
