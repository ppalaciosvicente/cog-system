import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const [{ data: congregations, error: congregationErr }, { data: areas, error: areaErr }] =
    await Promise.all([
      supabase.from("emccongregation").select("id,name,comments").order("name", { ascending: true }),
      supabase
        .from("emcelderarea")
        .select("congregationid,emcmember(id,fname,lname)")
        .not("congregationid", "is", null),
    ]);

  if (congregationErr) {
    return NextResponse.json(
      { error: `Failed to load congregations: ${congregationErr.message}` },
      { status: 500 },
    );
  }
  if (areaErr) {
    return NextResponse.json(
      { error: `Failed to load elder assignments: ${areaErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    congregations: congregations ?? [],
    areas: areas ?? [],
  });
}
