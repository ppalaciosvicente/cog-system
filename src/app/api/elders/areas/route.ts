import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireRole } from "@/lib/authz";

type AssignmentPayload = {
  memberId?: number;
  countryCode?: string | null;
  stateCode?: string | null;
  congregationId?: number | null;
};

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as AssignmentPayload))) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Select an elder." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("emcelderarea")
    .insert({
      memberid: memberId,
      countrycode: payload.countryCode ?? null,
      statecode: payload.stateCode ?? null,
      congregationid: payload.congregationId ?? null,
    })
    .select("id,congregationid,statecode,countrycode,emcmember(id,fname,lname,eldertypeid)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

export async function DELETE(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({ id: undefined }));
  const id = Number(payload?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("emcelderarea").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
