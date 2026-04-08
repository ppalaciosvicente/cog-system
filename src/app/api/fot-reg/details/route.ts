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
  locationId: string | number;
  locationName: string;
};

type DeletePayload = {
  regId?: string | number | null;
};

type UpdatePayload = {
  regId?: string | number | null;
  locationId?: string | number | null;
  locationName?: string | null;
  totalInParty?: number | null;
  namesInParty?: string | null;
  stayingAt?: string | null;
  allEightDays?: boolean | null;
  daysAtFeast?: string | null;
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

  const locationIdParts = locationIdParam
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!locationIdParts.length) {
    return NextResponse.json({ error: "Missing locationId." }, { status: 400 });
  }

  const locationIdValues: Array<string | number> = locationIdParts.map((part) =>
    /^\d+$/.test(part) ? Number(part) : part,
  );

  const supabase = createServiceRoleClient();
  const [{ data: locationData, error: locationErr }, { data: regsData, error: regsErr }] = await Promise.all([
    supabase.from("fotlocation").select("id,name").in("id", locationIdValues),
    supabase
      .from("fotreg")
      .select("id,memberid,locationid,totalinparty,accommodation,alleightdays,days,datecreated")
      .in("locationid", locationIdValues),
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

  const locationById = ((locationData ?? []) as FotLocationRow[]).reduce<Record<string, FotLocationRow>>(
    (acc, loc) => {
      const key = toIdKey(loc.id);
      if (key) acc[key] = loc;
      return acc;
    },
    {},
  );
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
    const locationKey = toIdKey(reg.locationid) ?? locationIdParam;
    return {
      regId: regId ?? "",
      contactName: displayName(member) || (Number.isFinite(memberId) ? `#${memberId}` : ""),
      totalInParty,
      namesInParty: names.join(", "),
      stayingAt: (reg.accommodation ?? "").trim(),
      daysAtFeast: reg.alleightdays ? "Entire feast" : String(reg.days ?? "").trim(),
      dateRegistered: String(reg.datecreated ?? ""),
      locationId: reg.locationid ?? locationIdParam,
      locationName:
        (locationKey && locationById[locationKey]?.name?.trim()) ||
        (location?.name ?? "").trim() ||
        `Location ${locationIdParam}`,
    };
  });

  const totalAttendance = rows.reduce((sum, row) => sum + Number(row.totalInParty || 0), 0);

  return NextResponse.json({
    locationName:
      (location?.name ?? "").trim() ||
      locationIdParts
        .map((id) => locationById[id]?.name?.trim())
        .filter(Boolean)
        .join(", ") ||
      `Location ${locationIdParam}`,
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

export async function PUT(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as UpdatePayload))) ?? {};
  const regIdRaw = toIdKey(payload.regId);
  const locationIdRaw = toIdKey(payload.locationId);
  if (!regIdRaw) {
    return NextResponse.json({ error: "Missing registration id." }, { status: 400 });
  }
  if (!locationIdRaw) {
    return NextResponse.json({ error: "Missing location id." }, { status: 400 });
  }

  const regIdValue: string | number = /^\d+$/.test(regIdRaw) ? Number(regIdRaw) : regIdRaw;
  const locationIdValue: string | number = /^\d+$/.test(locationIdRaw)
    ? Number(locationIdRaw)
    : locationIdRaw;

  const totalInParty = Number(payload.totalInParty ?? 0);
  const stayingAt = String(payload.stayingAt ?? "").trim();
  const allEightDays = Boolean(payload.allEightDays);
  const daysAtFeast = String(payload.daysAtFeast ?? "").trim();
  const namesInParty = String(payload.namesInParty ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  const supabase = createServiceRoleClient();

  // Update registration core fields
  const { error: updateRegErr } = await supabase
    .from("fotreg")
    .update({
      totalinparty: Number.isFinite(totalInParty) ? totalInParty : null,
      accommodation: stayingAt || null,
      alleightdays: allEightDays,
      days: allEightDays ? null : daysAtFeast || null,
    })
    .eq("id", regIdValue)
    .eq("locationid", locationIdValue);

  if (updateRegErr) {
    return NextResponse.json(
      { error: `Failed to update registration: ${updateRegErr.message}` },
      { status: 500 },
    );
  }

  // Replace individual names
  const { error: deleteNamesErr } = await supabase
    .from("fotregindividual")
    .delete()
    .eq("fotregid", regIdValue);
  if (deleteNamesErr) {
    return NextResponse.json(
      { error: `Failed to update party names: ${deleteNamesErr.message}` },
      { status: 500 },
    );
  }

  if (namesInParty.length) {
    const { error: insertNamesErr } = await supabase.from("fotregindividual").insert(
      namesInParty.map((name) => ({
        fotregid: regIdValue,
        name,
      })),
    );
    if (insertNamesErr) {
      return NextResponse.json(
        { error: `Failed to save party names: ${insertNamesErr.message}` },
        { status: 500 },
      );
    }
  }

  // Optionally update location name
  const locationName = String(payload.locationName ?? "").trim();
  if (locationName) {
    const { error: updateLocationErr } = await supabase
      .from("fotlocation")
      .update({ name: locationName })
      .eq("id", locationIdValue);
    if (updateLocationErr) {
      return NextResponse.json(
        { error: `Registration updated, but failed to update location name: ${updateLocationErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
