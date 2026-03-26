import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const congregationId = Number(request.nextUrl.searchParams.get("selected"));
  if (!Number.isFinite(congregationId) || congregationId <= 0) {
    return NextResponse.json({ error: "Missing or invalid congregation id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const [
    { data: congregation, error: congregationErr },
    { data: areaRows, error: areaErr },
    { data: members, error: membersErr },
  ] = await Promise.all([
    supabase
      .from("emccongregation")
      .select("id,name,comments")
      .eq("id", congregationId)
      .maybeSingle(),
    supabase
      .from("emcelderarea")
      .select("emcmember(id,fname,lname)")
      .eq("congregationid", congregationId),
    supabase
      .from("emcmember")
      .select("id,fname,lname,email,homephone,cellphone,city,statecode,countrycode,congregationid,householdid,spouseid")
      .eq("congregationid", congregationId)
      .eq("statusid", 1)
      .order("lname", { ascending: true })
      .order("fname", { ascending: true }),
  ]);

  if (congregationErr) {
    return NextResponse.json({ error: `Failed to load congregation: ${congregationErr.message}` }, { status: 500 });
  }
  if (!congregation) {
    return NextResponse.json({ error: "Congregation not found." }, { status: 404 });
  }
  if (areaErr) {
    return NextResponse.json({ error: `Failed to load responsible elders: ${areaErr.message}` }, { status: 500 });
  }
  if (membersErr) {
    return NextResponse.json({ error: `Failed to load congregation members: ${membersErr.message}` }, { status: 500 });
  }
  return NextResponse.json({
    congregation,
    areaRows: areaRows ?? [],
    members: members ?? [],
  });
}
