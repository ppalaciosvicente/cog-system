import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type FotLocationRow = {
  id: number | string;
  name: string | null;
};

type FotRegRow = {
  id: number | string | null;
  memberid: number | string | null;
  totalinparty: number | null;
  accommodation: string | null;
  alleightdays: boolean | null;
  days: string | null;
  datecreated: string | null;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
};

type DetailRow = {
  regId: string;
  contactName: string;
  totalInParty: number;
  namesInParty: string;
  stayingAt: string;
  daysAtFeast: string;
  dateRegistered: string;
};

type DeletePayload = {
  regId?: string | number | null;
};

function toIdKey(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim();
  return key.length ? key : null;
}

function displayName(m?: { fname: string | null; lname: string | null } | null) {
  if (!m) return "";
  const ln = (m.lname ?? "").trim();
  const fn = (m.fname ?? "").trim();
  if (!ln && !fn) return "";
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser", "emc_user"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canDelete = roleCheck.roleNames.includes("emc_admin");

  const locationIdParam = request.nextUrl.searchParams.get("locationId")?.trim() ?? "";
  if (!locationIdParam) {
    return NextResponse.json({ error: "Missing locationId." }, { status: 400 });
  }

  const locationIdValue: string | number = /^\d+$/.test(locationIdParam)
    ? Number(locationIdParam)
    : locationIdParam;

  const supabase = createServiceRoleClient();
  const [{ data: locationData, error: locationErr }, { data: regsData, error: regsErr }] =
    await Promise.all([
      supabase.from("fotlocation").select("id,name").eq("id", locationIdValue).limit(1),
      supabase
        .from("fotreg")
        .select("id,memberid,totalinparty,accommodation,alleightdays,days,datecreated")
        .eq("locationid", locationIdValue),
    ]);

  if (locationErr) {
    return NextResponse.json({ error: `Failed to load location: ${locationErr.message}` }, { status: 500 });
  }
  if (regsErr) {
    return NextResponse.json(
      { error: `Failed to load registrations: ${regsErr.message}` },
      { status: 500 },
    );
  }

  const location = ((locationData ?? []) as FotLocationRow[])[0] ?? null;
  const regs = (regsData ?? []) as FotRegRow[];

  const memberIds = Array.from(
    new Set(
      regs
        .map((r) => Number(r.memberid))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );

  const regIds = Array.from(
    new Set(regs.map((r) => toIdKey(r.id)).filter((id): id is string => id !== null)),
  );
  const [{ data: membersData, error: membersErr }, { data: individualsData, error: individualsErr }] =
    await Promise.all([
      memberIds.length
        ? supabase.from("emcmember").select("id,fname,lname").in("id", memberIds)
        : Promise.resolve({ data: [] as MemberRow[], error: null }),
      regIds.length
        ? supabase.from("fotregindividual").select("fotregid,name").in("fotregid", regIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    ]);

  if (membersErr) {
    return NextResponse.json({ error: `Failed to load members: ${membersErr.message}` }, { status: 500 });
  }
  if (individualsErr) {
    return NextResponse.json(
      { error: `Failed to load party names: ${individualsErr.message}` },
      { status: 500 },
    );
  }

  const membersById = ((membersData ?? []) as MemberRow[]).reduce<Record<number, MemberRow>>(
    (acc, row) => {
      acc[row.id] = row;
      return acc;
    },
    {},
  );

  const regIdSet = new Set(regIds);
  const namesByRegId: Record<string, string[]> = {};
  ((individualsData ?? []) as Array<Record<string, unknown>>).forEach((row) => {
    const name = String(row.name ?? "").trim();
    if (!name) return;

    const regId = toIdKey(row.fotregid as number | string | null | undefined);
    if (!regId || !regIdSet.has(regId)) return;

    const current = namesByRegId[regId] ?? [];
    current.push(name);
    namesByRegId[regId] = current;
  });

  const rows: DetailRow[] = regs.map((reg) => {
    const memberId = Number(reg.memberid);
    const member = Number.isFinite(memberId) ? membersById[memberId] : undefined;
    const regId = toIdKey(reg.id);
    const names = regId ? namesByRegId[regId] ?? [] : [];
    const totalInParty = Number(reg.totalinparty ?? 0);
    return {
      regId: regId ?? "",
      contactName: displayName(member) || (Number.isFinite(memberId) ? `#${memberId}` : ""),
      totalInParty,
      namesInParty: names.join(", "),
      stayingAt: (reg.accommodation ?? "").trim(),
      daysAtFeast: reg.alleightdays ? "Entire feast" : String(reg.days ?? "").trim(),
      dateRegistered: String(reg.datecreated ?? ""),
    };
  });

  const totalAttendance = rows.reduce((sum, row) => sum + Number(row.totalInParty || 0), 0);

  return NextResponse.json({
    locationName: (location?.name ?? "").trim() || `Location ${locationIdParam}`,
    totalAttendance,
    rows,
    canDelete,
  });
}

export async function DELETE(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as DeletePayload))) ?? {};
  const regIdRaw = toIdKey(payload.regId as string | number | null | undefined);
  if (!regIdRaw) {
    return NextResponse.json({ error: "Missing registration id." }, { status: 400 });
  }

  const regIdValue: string | number = /^\d+$/.test(regIdRaw) ? Number(regIdRaw) : regIdRaw;
  const supabase = createServiceRoleClient();
  const { error: deleteIndividualsErr } = await supabase
    .from("fotregindividual")
    .delete()
    .eq("fotregid", regIdValue);
  if (deleteIndividualsErr) {
    return NextResponse.json(
      { error: `Failed to delete party names: ${deleteIndividualsErr.message}` },
      { status: 500 },
    );
  }

  const { error: deleteRegErr } = await supabase.from("fotreg").delete().eq("id", regIdValue);
  if (deleteRegErr) {
    return NextResponse.json(
      { error: `Failed to delete registration: ${deleteRegErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
