import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type MemberOptionRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  statecode: string | null;
  countrycode: string | null;
  householdid: number | null;
  spouseid: number | null;
};

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("emcmember")
    .select("id,fname,lname,statecode,countrycode,householdid,spouseid")
    .eq("statusid", 1)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members: (data ?? []) as MemberOptionRow[] });
}
