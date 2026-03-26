import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type AreaRow = {
  id: number;
  memberid: number;
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type Payload = {
  includeAllMembers?: boolean;
  selectedAreaIds?: number[];
};

function normalizeCode(code?: string | null) {
  return String(code ?? "")
    .trim()
    .toUpperCase();
}

function normalizeRoleName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function hasRole(roleNames: string[], candidates: string[]) {
  const roleSet = new Set(roleNames.map((r) => normalizeRoleName(r)).filter(Boolean));
  return candidates.some((candidate) => roleSet.has(normalizeRoleName(candidate)));
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser", "emc_user"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as Payload))) ?? {};
  const includeAllMembers = Boolean(payload.includeAllMembers);
  const selectedAreaIds = Array.isArray(payload.selectedAreaIds)
    ? payload.selectedAreaIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];

  const canIncludeAllMembers = hasRole(roleCheck.roleNames, [
    "emc_admin",
    "admin",
    "emc_superuser",
    "emc_super_user",
    "superuser",
    "super_user",
  ]);
  if (includeAllMembers && !canIncludeAllMembers) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();

  if (includeAllMembers) {
    const { data, error } = await supabase
      .from("emcmember")
      .select("id,fname,lname,email")
      .eq("baptized", true)
      .eq("statusid", 1)
      .order("lname", { ascending: true })
      .order("fname", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ members: data ?? [] });
  }

  if (!roleCheck.memberId) {
    return NextResponse.json({ error: "No member record linked to this account." }, { status: 400 });
  }

  const { data: areaData, error: areaErr } = await supabase
    .from("emcelderarea")
    .select("id,memberid,countrycode,statecode,congregationid")
    .eq("memberid", roleCheck.memberId);
  if (areaErr) {
    return NextResponse.json({ error: `Failed to load areas: ${areaErr.message}` }, { status: 500 });
  }

  let areas = (areaData ?? []) as AreaRow[];
  if (selectedAreaIds.length > 0) {
    const selectedSet = new Set(selectedAreaIds);
    areas = areas.filter((row) => selectedSet.has(row.id));
  }
  if (!areas.length) {
    return NextResponse.json({ members: [] });
  }

  const congregationIds = Array.from(
    new Set(
      areas
        .map((area) => area.congregationid)
        .filter((id): id is number => Boolean(id)),
    ),
  );

  const stateAreas = areas.filter((area) => !area.congregationid && area.statecode);
  const countryAreas = areas.filter(
    (area) => !area.congregationid && !area.statecode && area.countrycode,
  );

  let query = supabase
    .from("emcmember")
    .select("id,fname,lname,email")
    .eq("baptized", true)
    .eq("statusid", 1)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true });

  const filters: string[] = [];
  if (congregationIds.length > 0) {
    filters.push(`congregationid.in.(${congregationIds.join(",")})`);
  }

  stateAreas.forEach((area) => {
    const cc = normalizeCode(area.countrycode);
    const sc = normalizeCode(area.statecode);
    if (cc && sc) {
      filters.push(`and(countrycode.eq.${cc},statecode.eq.${sc})`);
    }
  });

  countryAreas.forEach((area) => {
    const cc = normalizeCode(area.countrycode);
    if (cc) filters.push(`countrycode.eq.${cc}`);
  });

  if (!filters.length) {
    return NextResponse.json({ members: [] });
  }

  query = query.or(filters.join(","));
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members: data ?? [] });
}
