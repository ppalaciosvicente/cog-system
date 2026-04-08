import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type FotLocationRow = {
  id: number | string;
  name: string | null;
};

type LocationOption = {
  id: string;
  name: string;
};

function toIdKey(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim();
  return key.length ? key : null;
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin", "emc_superuser", "emc_user"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("fotlocation")
    .select("id,name")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: `Failed to load FoT locations: ${error.message}` }, { status: 500 });
  }

  const locations: LocationOption[] = ((data ?? []) as FotLocationRow[])
    .map((row) => {
      const id = toIdKey(row.id);
      if (!id) return null;
      return {
        id,
        name: (row.name ?? "").trim() || `Location #${id}`,
      } as LocationOption;
    })
    .filter((row): row is LocationOption => Boolean(row));

  return NextResponse.json({ locations });
}
