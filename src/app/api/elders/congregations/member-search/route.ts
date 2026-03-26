import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type MemberOptionRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  city: string | null;
  statecode: string | null;
  countrycode: string | null;
  congregationid: number | null;
  householdid: number | null;
  spouseid: number | null;
};

const MAX_RESULTS = 100;

function escapeIlike(value: string) {
  return value.replace(/[%_]/g, "\\$&");
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const congregationId = Number(request.nextUrl.searchParams.get("congregationId"));
  if (!Number.isFinite(congregationId) || congregationId <= 0) {
    return NextResponse.json({ error: "Missing or invalid congregation id." }, { status: 400 });
  }

  const name = (request.nextUrl.searchParams.get("name") ?? "").trim();
  const city = (request.nextUrl.searchParams.get("city") ?? "").trim();
  const countryCode = (request.nextUrl.searchParams.get("countryCode") ?? "").trim().toUpperCase();
  const stateCode = (request.nextUrl.searchParams.get("stateCode") ?? "").trim().toUpperCase();

  if (!name && !city && !countryCode && !stateCode) {
    return NextResponse.json({ members: [], truncated: false });
  }

  const supabase = createServiceRoleClient();
  let query = supabase
    .from("emcmember")
    .select("id,fname,lname,city,statecode,countrycode,congregationid,householdid,spouseid")
    .eq("statusid", 1)
    .is("congregationid", null)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true })
    .limit(MAX_RESULTS + 1);

  if (countryCode) {
    query = query.eq("countrycode", countryCode);
  }
  if (stateCode) {
    query = query.eq("statecode", stateCode);
  }
  if (city) {
    query = query.ilike("city", `%${escapeIlike(city)}%`);
  }

  const nameTokens = name
    .replace(/[,%]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 2);

  nameTokens.forEach((token) => {
    const escaped = escapeIlike(token);
    query = query.or(`fname.ilike.%${escaped}%,lname.ilike.%${escaped}%`);
  });

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const members = ((data ?? []) as MemberOptionRow[]).slice(0, MAX_RESULTS);
  return NextResponse.json({
    members,
    truncated: (data ?? []).length > MAX_RESULTS,
  });
}
