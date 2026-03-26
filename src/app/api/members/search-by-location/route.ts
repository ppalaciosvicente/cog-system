import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type AreaRow = {
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

type MemberRow = {
  countrycode: string | null;
  statecode: string | null;
  congregationid: number | null;
};

function normalizeCode(code?: string | null) {
  return String(code ?? "")
    .trim()
    .toUpperCase();
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser", "emc_user"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const canSeeAll =
    roleCheck.roleNames.includes("emc_admin") ||
    roleCheck.roleNames.includes("emc_superuser");

  const country = String(request.nextUrl.searchParams.get("country") ?? "")
    .trim()
    .toUpperCase();
  const state = String(request.nextUrl.searchParams.get("state") ?? "")
    .trim()
    .toUpperCase();
  const usesState = country === "US" || country === "CA" || country === "AU";

  if (!country) {
    return NextResponse.json({ error: "Country is required." }, { status: 400 });
  }
  if (usesState && !state) {
    return NextResponse.json({ error: "State/province is required." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  let query = supabase
    .from("emcmember")
    .select(
      "id,fname,lname,address,address2,city,zip,statecode,countrycode,congregationid,householdid,spouseid,homephone,cellphone,email,baptized,tithestatusid,emctithestatus(name)",
    )
    .eq("countrycode", country)
    .eq("statusid", 1)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true });

  if (usesState) query = query.eq("statecode", state);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let members = (data ?? []) as Array<MemberRow & Record<string, unknown>>;

  if (!canSeeAll) {
    if (!roleCheck.memberId) {
      return NextResponse.json({ error: "No member record linked to this account." }, { status: 400 });
    }

    const { data: areaData, error: areaErr } = await supabase
      .from("emcelderarea")
      .select("countrycode,statecode,congregationid")
      .eq("memberid", roleCheck.memberId);
    if (areaErr) {
      return NextResponse.json({ error: `Failed to load elder areas: ${areaErr.message}` }, { status: 500 });
    }

    const areas = (areaData ?? []) as AreaRow[];
    members = members.filter((member) =>
      areas.some((scope) => {
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
      }),
    );
  }

  return NextResponse.json({ members });
}
