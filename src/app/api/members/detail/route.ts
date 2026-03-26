import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = Number(request.nextUrl.searchParams.get("memberId"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("emcmember")
    .select(
      `
      id,
      spouseid,
      householdid,
      fname, lname,
      address, address2, city, statecode, zip, countrycode,
      homephone, cellphone, email,
      baptized, baptizeddate,
      tithestatusid,
      comments,
      eldercomments,
      statusid,
      congregationid,
      datecreated, dateupdated
    `,
    )
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ member: data });
}
