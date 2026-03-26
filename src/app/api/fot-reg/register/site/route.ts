import { NextRequest, NextResponse } from "next/server";

import { resolveFotTokenHash } from "@/lib/fot/tokens";
import { createServiceRoleClient } from "@/lib/supabase/service";

type Payload = {
  token?: string;
  siteId?: string | number;
  totalInParty?: number;
  names?: string[];
  accommodation?: string;
  allEightDays?: boolean;
  days?: string;
};

type TokenRow = {
  memberid: number | string | null;
  isactive: boolean | null;
};

type MemberRow = {
  id: number;
  statusid: number | null;
  baptized: boolean | null;
};

type ExistingRegRow = {
  id: number | string | null;
};

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toRegId(value: unknown) {
  const id = toText(value);
  if (!id) return null;
  return /^\d+$/.test(id) ? Number(id) : id;
}

function normalizeNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((name) => toText(name)).filter((name) => name.length > 0);
}

function parseSiteId(value: unknown) {
  const raw = toText(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({} as Payload))) ?? {};

  const token = toText(payload.token);
  const parsedSiteId = parseSiteId(payload.siteId);
  const totalInParty = Number(payload.totalInParty ?? 0);
  const names = normalizeNames(payload.names);
  const accommodation = toText(payload.accommodation);
  const allEightDays = Boolean(payload.allEightDays);
  const days = toText(payload.days);

  if (!token) {
    return NextResponse.json({ error: "Missing registration token." }, { status: 400 });
  }
  if (parsedSiteId === null) {
    return NextResponse.json({ error: "Missing location id." }, { status: 400 });
  }
  if (!Number.isFinite(totalInParty) || totalInParty < 1 || totalInParty > 9) {
    return NextResponse.json({ error: "Total in party must be between 1 and 9." }, { status: 400 });
  }
  if (names.length !== totalInParty) {
    return NextResponse.json(
      { error: "Please enter one full name for each person in your party." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const tokenHash = resolveFotTokenHash(token);
  const { data: tokenData, error: tokenErr } = await supabase
    .from("fotregtoken")
    .select("memberid,isactive")
    .eq("tokenhash", tokenHash)
    .eq("isactive", true)
    .limit(1);

  if (tokenErr) {
    return NextResponse.json({ error: `Failed to validate token: ${tokenErr.message}` }, { status: 500 });
  }

  const tokenRow = ((tokenData ?? []) as TokenRow[])[0] ?? null;
  const memberId = Number(tokenRow?.memberid ?? 0);
  if (!tokenRow || !tokenRow.isactive || !Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Invalid or inactive registration token." }, { status: 400 });
  }

  const [{ data: memberData, error: memberErr }, { data: locationData, error: locationErr }] =
    await Promise.all([
      supabase.from("emcmember").select("id,statusid,baptized").eq("id", memberId).limit(1),
      supabase.from("fotlocation").select("id").eq("id", parsedSiteId).limit(1),
    ]);

  if (memberErr) {
    return NextResponse.json({ error: `Failed to validate member: ${memberErr.message}` }, { status: 500 });
  }
  if (locationErr) {
    return NextResponse.json({ error: `Failed to validate location: ${locationErr.message}` }, { status: 500 });
  }

  const member = ((memberData ?? []) as MemberRow[])[0] ?? null;
  if (!member || member.statusid !== 1 || member.baptized !== true) {
    return NextResponse.json({ error: "This registration link is no longer valid." }, { status: 400 });
  }
  if (!Array.isArray(locationData) || locationData.length === 0) {
    return NextResponse.json({ error: "Invalid location id." }, { status: 400 });
  }

  const { data: existingRegsData, error: existingRegsErr } = await supabase
    .from("fotreg")
    .select("id")
    .eq("memberid", memberId);
  if (existingRegsErr) {
    return NextResponse.json(
      { error: `Failed to load existing registration: ${existingRegsErr.message}` },
      { status: 500 },
    );
  }

  const existingRegIds = ((existingRegsData ?? []) as ExistingRegRow[])
    .map((row) => toRegId(row.id))
    .filter((id): id is string | number => id !== null);

  if (existingRegIds.length > 0) {
    const { error: deleteIndividualsErr } = await supabase
      .from("fotregindividual")
      .delete()
      .in("fotregid", existingRegIds);
    if (deleteIndividualsErr) {
      return NextResponse.json(
        { error: `Failed to clear existing party names: ${deleteIndividualsErr.message}` },
        { status: 500 },
      );
    }
  }

  const { error: deleteRegsErr } = await supabase.from("fotreg").delete().eq("memberid", memberId);
  if (deleteRegsErr) {
    return NextResponse.json(
      { error: `Failed to clear existing registration: ${deleteRegsErr.message}` },
      { status: 500 },
    );
  }

  const { data: insertedRegData, error: insertRegErr } = await supabase
    .from("fotreg")
    .insert({
      memberid: memberId,
      locationid: parsedSiteId,
      totalinparty: totalInParty,
      accommodation,
      alleightdays: allEightDays,
      days,
    })
    .select("id")
    .limit(1);
  if (insertRegErr) {
    return NextResponse.json(
      { error: `Failed to save registration: ${insertRegErr.message}` },
      { status: 500 },
    );
  }

  const fotRegId = toRegId((insertedRegData?.[0] as { id?: unknown } | undefined)?.id);
  if (fotRegId === null) {
    return NextResponse.json({ error: "Could not read new registration id." }, { status: 500 });
  }

  const individualRows = names.map((name) => ({
    fotregid: fotRegId,
    name,
  }));

  const { error: insertIndividualsErr } = await supabase.from("fotregindividual").insert(individualRows);
  if (insertIndividualsErr) {
    return NextResponse.json(
      { error: `Failed to save party names: ${insertIndividualsErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
