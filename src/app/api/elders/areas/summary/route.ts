import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type AreaRow = {
  congregationid: number | null;
  countrycode: string | null;
  statecode: string | null;
};

type CongregationRow = {
  id: number;
  name: string | null;
};

type CountryRow = {
  code: string | null;
  name: string | null;
};

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
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
    .select("congregationid,countrycode,statecode")
    .eq("memberid", roleCheck.memberId);

  if (areaErr) {
    return NextResponse.json({ error: areaErr.message }, { status: 500 });
  }

  const areas = (areaData ?? []) as AreaRow[];
  if (!areas.length) {
    return NextResponse.json({ label: "No areas assigned" });
  }

  const congregationIds = Array.from(
    new Set(
      areas
        .map((row) => Number(row.congregationid))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  const countryCodes = Array.from(
    new Set(
      areas
        .map((row) => normalizeCode(row.countrycode))
        .filter(Boolean),
    ),
  );

  const [{ data: congregationData, error: congregationErr }, { data: countryData, error: countryErr }] =
    await Promise.all([
      congregationIds.length
        ? supabase.from("emccongregation").select("id,name").in("id", congregationIds)
        : Promise.resolve({ data: [] as CongregationRow[], error: null }),
      countryCodes.length
        ? supabase.from("emccountry").select("code,name").in("code", countryCodes)
        : Promise.resolve({ data: [] as CountryRow[], error: null }),
    ]);

  if (congregationErr) {
    return NextResponse.json({ error: congregationErr.message }, { status: 500 });
  }
  if (countryErr) {
    return NextResponse.json({ error: countryErr.message }, { status: 500 });
  }

  const congregationNameById = new Map<number, string>();
  ((congregationData ?? []) as CongregationRow[]).forEach((row) => {
    const name = String(row.name ?? "").trim();
    if (!name) return;
    congregationNameById.set(row.id, name);
  });

  const countryNameByCode = new Map<string, string>();
  ((countryData ?? []) as CountryRow[]).forEach((row) => {
    const code = normalizeCode(row.code);
    const name = String(row.name ?? "").trim();
    if (!code || !name) return;
    countryNameByCode.set(code, name);
  });

  const labels = Array.from(
    new Set(
      areas
        .map((row) => {
          const congregationId = Number(row.congregationid);
          if (Number.isFinite(congregationId) && congregationId > 0) {
            return congregationNameById.get(congregationId) ?? `Congregation #${congregationId}`;
          }
          const countryCode = normalizeCode(row.countrycode);
          const stateCode = normalizeCode(row.statecode);
          if (stateCode && countryCode) return `${stateCode} (${countryCode})`;
          if (countryCode) return countryNameByCode.get(countryCode) ?? countryCode;
          return "";
        })
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ label: labels.length ? labels.join("; ") : "No areas assigned" });
}
