import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const view = String(request.nextUrl.searchParams.get("view") ?? "options")
    .trim()
    .toLowerCase();
  const memberId = Number(request.nextUrl.searchParams.get("memberId"));

  const supabase = createServiceRoleClient();

  if (Number.isFinite(memberId) && memberId > 0) {
    const { data, error } = await supabase
      .from("emcmember")
      .select(
        `
        id,
        fname, lname,
        address, address2, city, statecode, zip, countrycode,
        homephone, cellphone, email,
        eldertypeid,
        emceldertype(name),
        datecreated, dateupdated
      `,
      )
      .eq("id", memberId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ member: data });
  }

  if (view === "list") {
    const { data, error } = await supabase
      .from("emcmember")
      .select(
        "id,fname,lname,homephone,cellphone,email,eldertypeid,emceldertype(name,sortorder)",
      )
      .not("eldertypeid", "is", null)
      .order("sortorder", {
        foreignTable: "emceldertype",
        ascending: true,
      })
      .order("lname", { ascending: true })
      .order("fname", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ members: data ?? [] });
  }

  const { data, error } = await supabase
    .from("emcmember")
    .select("id,fname,lname,statecode,countrycode,eldertypeid")
    .not("eldertypeid", "is", null)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ members: data ?? [] });
}
