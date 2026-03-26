import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser", "emc_user"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const idsParam = String(request.nextUrl.searchParams.get("ids") ?? "").trim();
  const ids = idsParam
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);

  const supabase = createServiceRoleClient();
  const query = supabase.from("emccongregation").select("id,name");
  const { data, error } =
    ids.length > 0 ? await query.in("id", ids) : await query.order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ congregations: data ?? [] });
}
