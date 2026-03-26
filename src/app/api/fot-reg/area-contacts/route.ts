import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type AreaRow = {
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type FotRegRow = {
  id: number | string | null;
  memberid: number | string | null;
  locationid: number | string | null;
  totalinparty: number | null;
  accommodation: string | null;
  alleightdays: boolean | null;
  days: string | null;
  datecreated: string | null;
};

type FotLocationRow = {
  id: number | string;
  name: string | null;
};

type DetailRow = {
  contactName: string;
  locationName: string;
  totalInParty: number;
  namesInParty: string;
  stayingAt: string;
  daysAtFeast: string;
  dateRegistered: string;
};

function normalizeCode(code?: string | null) {
  return String(code ?? "")
    .trim()
    .toUpperCase();
}

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

function memberInAreas(member: MemberRow, areas: AreaRow[]) {
  return areas.some((scope) => {
    if (scope.congregationid) {
      return member.congregationid === scope.congregationid;
    }
    const scopeCountry = normalizeCode(scope.countrycode);
    const scopeState = normalizeCode(scope.statecode);
    const memberCountry = normalizeCode(member.countrycode);
    const memberState = normalizeCode(member.statecode);
    if (scopeState) {
      return memberCountry === scopeCountry && memberState === scopeState;
    }
    if (scopeCountry) {
      return memberCountry === scopeCountry;
    }
    return false;
  });
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser", "emc_user"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!roleCheck.memberId) {
    return NextResponse.json({ error: "No member record linked to this account." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: areaData, error: areaErr } = await supabase
    .from("emcelderarea")
    .select("countrycode,statecode,congregationid")
    .eq("memberid", roleCheck.memberId);
  if (areaErr) {
    return NextResponse.json({ error: `Failed to load areas: ${areaErr.message}` }, { status: 500 });
  }

  const areas = (areaData ?? []) as AreaRow[];
  if (!areas.length) return NextResponse.json({ rows: [] as DetailRow[] });

  const { data: memberData, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,fname,lname,countrycode,statecode,congregationid");
  if (memberErr) {
    return NextResponse.json({ error: `Failed to load members: ${memberErr.message}` }, { status: 500 });
  }

  const scopedMembers = ((memberData ?? []) as MemberRow[]).filter((member) =>
    memberInAreas(member, areas),
  );
  const scopedMemberIds = Array.from(new Set(scopedMembers.map((row) => row.id)));
  if (!scopedMemberIds.length) return NextResponse.json({ rows: [] as DetailRow[] });

  const [
    { data: regsData, error: regsErr },
    { data: individualsData, error: individualsErr },
    { data: locationsData, error: locationsErr },
  ] =
    await Promise.all([
      supabase
        .from("fotreg")
        .select("id,memberid,locationid,totalinparty,accommodation,alleightdays,days,datecreated")
        .in("memberid", scopedMemberIds),
      supabase.from("fotregindividual").select("*"),
      supabase.from("fotlocation").select("id,name"),
    ]);
  if (regsErr) {
    return NextResponse.json(
      { error: `Failed to load registrations: ${regsErr.message}` },
      { status: 500 },
    );
  }
  if (individualsErr) {
    return NextResponse.json(
      { error: `Failed to load party names: ${individualsErr.message}` },
      { status: 500 },
    );
  }
  if (locationsErr) {
    return NextResponse.json(
      { error: `Failed to load locations: ${locationsErr.message}` },
      { status: 500 },
    );
  }

  const membersById = scopedMembers.reduce<Record<number, MemberRow>>((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  const regs = (regsData ?? []) as FotRegRow[];
  const locationNameById = ((locationsData ?? []) as FotLocationRow[]).reduce<Record<string, string>>(
    (acc, location) => {
      const locationId = toIdKey(location.id);
      if (!locationId) return acc;
      acc[locationId] = String(location.name ?? "").trim() || `Location #${locationId}`;
      return acc;
    },
    {},
  );
  const regIds = new Set(
    regs.map((r) => toIdKey(r.id)).filter((id): id is string => id !== null),
  );
  const namesByRegId: Record<string, string[]> = {};
  const regIdCandidateKeys = ["fotregid", "regid", "registrationid", "fotregistrationid", "reg_id"];
  ((individualsData ?? []) as Array<Record<string, unknown>>).forEach((row) => {
    const name = String(row.name ?? "").trim();
    if (!name) return;
    const regId = regIdCandidateKeys
      .map((key) => toIdKey(row[key] as number | string | null | undefined))
      .find((value): value is string => Boolean(value));
    if (!regId || !regIds.has(regId)) return;
    const list = namesByRegId[regId] ?? [];
    list.push(name);
    namesByRegId[regId] = list;
  });

  const rows: DetailRow[] = regs
    .map((reg) => {
      const memberId = Number(reg.memberid);
      const member = Number.isFinite(memberId) ? membersById[memberId] : undefined;
      const regId = toIdKey(reg.id);
      const names = regId ? namesByRegId[regId] ?? [] : [];
      const locationId = toIdKey(reg.locationid) ?? "";
      return {
        contactName: displayName(member) || (Number.isFinite(memberId) ? `#${memberId}` : ""),
        locationName: locationNameById[locationId] ?? (locationId ? `Location #${locationId}` : ""),
        totalInParty: Number(reg.totalinparty ?? 0),
        namesInParty: names.join(", "),
        stayingAt: (reg.accommodation ?? "").trim(),
        daysAtFeast: reg.alleightdays ? "Entire feast" : String(reg.days ?? "").trim(),
        dateRegistered: String(reg.datecreated ?? ""),
      };
    })
    .sort((a, b) => {
      const byName = a.contactName.localeCompare(b.contactName);
      if (byName !== 0) return byName;
      return a.dateRegistered.localeCompare(b.dateRegistered);
    });

  return NextResponse.json({ rows });
}
