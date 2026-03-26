import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireRole } from "@/lib/authz";

type MemberPayload = {
  memberId?: number;
};

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as MemberPayload))) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: areas, error: areaErr } = await supabase
    .from("emcelderarea")
    .select("id,countrycode,statecode,congregationid")
    .eq("memberid", memberId);

  if (areaErr) {
    return NextResponse.json({ error: areaErr.message }, { status: 500 });
  }

  const congregationIds = Array.from(
    new Set((areas ?? []).map((row) => row.congregationid).filter(Boolean)),
  ) as number[];
  let congregationNameById: Record<number, string> = {};

  if (congregationIds.length > 0) {
    const { data: congregations, error: congErr } = await supabase
      .from("emccongregation")
      .select("id,name")
      .in("id", congregationIds);
    if (congErr) {
      return NextResponse.json({ error: congErr.message }, { status: 500 });
    }
    congregationNameById = {};
    (congregations ?? []).forEach((row) => {
      if (row?.id != null) congregationNameById[row.id] = row.name ?? "";
    });
  }

  return NextResponse.json({ ok: true, areas, congregationNameById });
}

export async function DELETE(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as MemberPayload))) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("emcelderarea").delete().eq("memberid", memberId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
