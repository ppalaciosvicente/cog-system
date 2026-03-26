import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type FotLocationRow = {
  id: number | string;
  name: string | null;
};

type FotRegRow = {
  locationid: number | string | null;
  totalinparty: number | null;
};

type LocationAttendanceRow = {
  locationId: string;
  locationName: string;
  attendance: number;
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
  const isAdmin = roleCheck.roleNames.includes("emc_admin");

  const supabase = createServiceRoleClient();
  const [{ data: locations, error: locationErr }, { data: regs, error: regErr }] =
    await Promise.all([
      supabase.from("fotlocation").select("id,name").order("name", { ascending: true }),
      supabase.from("fotreg").select("locationid,totalinparty"),
    ]);

  if (locationErr) {
    return NextResponse.json({ error: `Failed to load FoT locations: ${locationErr.message}` }, { status: 500 });
  }
  if (regErr) {
    return NextResponse.json({ error: `Failed to load FoT registrations: ${regErr.message}` }, { status: 500 });
  }

  const attendanceByLocationId = ((regs ?? []) as FotRegRow[]).reduce<Record<string, number>>(
    (acc, row) => {
      const locationId = toIdKey(row.locationid);
      if (locationId === null) return acc;
      acc[locationId] = (acc[locationId] ?? 0) + Number(row.totalinparty ?? 0);
      return acc;
    },
    {},
  );

  const locationNameById = ((locations ?? []) as FotLocationRow[]).reduce<Record<string, string>>(
    (acc, location) => {
      const locationId = toIdKey(location.id);
      if (locationId === null) return acc;
      acc[locationId] = (location.name ?? "").trim() || `Location #${locationId}`;
      return acc;
    },
    {},
  );

  const rows: LocationAttendanceRow[] = Object.entries(attendanceByLocationId)
    .filter(([, attendance]) => attendance > 0)
    .map(([locationId, attendance]) => ({
      locationId,
      locationName: locationNameById[locationId] ?? `Location #${locationId}`,
      attendance,
    }))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));

  return NextResponse.json({ rows, isAdmin });
}
