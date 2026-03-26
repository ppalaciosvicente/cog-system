import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireRole } from "@/lib/authz";

type MembersPayload = {
  action: "add" | "remove";
  memberIds?: number[];
  congregationId?: number;
};

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as MembersPayload))) ?? {};
  const parsedIds = Array.isArray(payload.memberIds)
    ? payload.memberIds.map((memberId: number | string) => Number(memberId))
    : [];
  const ids = parsedIds.filter(
    (memberId: number): memberId is number => Number.isFinite(memberId) && memberId > 0,
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "Select at least one member." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const isAdd = payload.action === "add";
  if (isAdd && (!payload.congregationId || !Number.isFinite(payload.congregationId))) {
    return NextResponse.json({ error: "Missing congregation id." }, { status: 400 });
  }

  const updates =
    isAdd
      ? supabase.from("emcmember").update({ congregationid: payload.congregationId, dateupdated: now })
      : supabase.from("emcmember").update({ congregationid: null, dateupdated: now });

  const result = await updates.in("id", ids);
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    count: ids.length,
    action: isAdd ? "added" : "removed",
  });
}
