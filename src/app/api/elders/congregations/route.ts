import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireRole } from "@/lib/authz";

type CongregationPayload = {
  id?: number;
  name?: string | null;
  comments?: string | null;
};

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json()) as CongregationPayload;
  const name = String(payload.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Congregation name is required." }, { status: 400 });
  }

  const comments = String(payload.comments ?? "").trim() || null;
  const supabase = createServiceRoleClient();

  const result = payload.id
    ? await supabase
        .from("emccongregation")
        .update({ name, comments })
        .eq("id", payload.id)
        .select("id")
        .single()
    : await supabase
        .from("emccongregation")
        .insert({ name, comments })
        .select("id")
        .single();

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: result.data?.id ?? payload.id ?? null });
}

export async function DELETE(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({} as { id?: number }));
  const id = Number(payload?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Missing congregation id." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const [{ count: memberCount, error: memberErr }, { count: areaCount, error: areaErr }] =
    await Promise.all([
      supabase
        .from("emcmember")
        .select("id", { count: "exact", head: true })
        .eq("congregationid", id),
      supabase
        .from("emcelderarea")
        .select("id", { count: "exact", head: true })
        .eq("congregationid", id),
    ]);

  if (memberErr || areaErr) {
    return NextResponse.json(
      {
        error:
          memberErr?.message ??
          areaErr?.message ??
          "Failed to verify congregation relationships.",
      },
      { status: 500 },
    );
  }

  if ((memberCount ?? 0) > 0 || (areaCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Congregation cannot be deleted: it still has assigned members or responsible elders.",
      },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("emccongregation").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
