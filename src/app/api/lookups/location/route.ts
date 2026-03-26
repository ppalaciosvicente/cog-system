import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { CountryRow, StateRow } from "@/types/lookups";

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(
    ["emc_admin", "emc_superuser", "emc_user"],
    request,
  );
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const [{ data: countries, error: cErr }, { data: states, error: sErr }] =
    await Promise.all([
      supabase.from("emccountry").select("code,name"),
      supabase.from("emcstate").select("code,name,countrycode"),
    ]);

  if (cErr) {
    return NextResponse.json({ error: `Failed to load countries: ${cErr.message}` }, { status: 500 });
  }
  if (sErr) {
    return NextResponse.json({ error: `Failed to load states: ${sErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    countries: (countries ?? []) as CountryRow[],
    states: (states ?? []) as StateRow[],
  });
}
