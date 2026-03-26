import { NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireRole } from "@/lib/authz";

type SpousePayload = {
  memberId?: number | string;
  spouseMemberId?: number | string;
  memberContact?: Partial<MemberContactPayload>;
  spouseContact?: Partial<MemberContactPayload>;
};

type MemberSpouseRow = {
  id: number;
  spouseid: number | null;
  householdid: number | null;
  congregationid: number | null;
  lname: string | null;
  address: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  statecode: string | null;
  countrycode: string | null;
  homephone: string | null;
  cellphone: string | null;
  statusid: number | null;
  tithestatusid: number | null;
};

type MemberContactPayload = {
  lname: string | null;
  address: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  statecode: string | null;
  countrycode: string | null;
  homephone: string | null;
  cellphone: string | null;
  statusid: number | null;
  tithestatusid: number | null;
};

type MemberContactPatch = Partial<MemberContactPayload>;

function parsePositiveId(value: number | string | undefined) {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

async function loadMembers(
  supabase: ReturnType<typeof createServiceRoleClient>,
  ids: number[],
) {
  const { data, error } = await supabase
    .from("emcmember")
    .select("id,spouseid,householdid,congregationid,lname,address,address2,zip,city,statecode,countrycode,homephone,cellphone,statusid,tithestatusid")
    .in("id", ids);
  if (error) return { rows: null as MemberSpouseRow[] | null, error };
  return { rows: (data ?? []) as MemberSpouseRow[], error: null };
}

function normalizeContactValue(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeContactPatch(payload: unknown): MemberContactPatch | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const source = payload as Record<string, unknown>;
  const patch: MemberContactPatch = {};
  const keys: (keyof MemberContactPayload)[] = [
    "lname",
    "address",
    "address2",
    "zip",
    "city",
    "statecode",
    "countrycode",
    "homephone",
    "cellphone",
    "statusid",
    "tithestatusid",
  ];

  keys.forEach((key) => {
    if (!(key in source)) return;
    if (key === "statusid" || key === "tithestatusid") {
      const numeric = Number(source[key]);
      patch[key] = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
      return;
    }
    const normalized = normalizeContactValue(source[key]);
    patch[key] =
      key === "statecode" || key === "countrycode"
        ? (normalized ? normalized.toUpperCase() : null)
        : normalized;
  });

  return Object.keys(patch).length > 0 ? patch : undefined;
}

async function updateMemberSpouse(
  supabase: ReturnType<typeof createServiceRoleClient>,
  memberId: number,
  spouseId: number | null,
  householdId: number | null,
  now: string,
  contactPatch?: MemberContactPatch,
  congregationId?: number | null,
) {
  const updatePayload = {
    spouseid: spouseId,
    householdid: householdId,
    dateupdated: now,
    ...(contactPatch ?? {}),
  } as Record<string, string | number | boolean | null>;
  if (congregationId !== undefined) {
    updatePayload.congregationid = congregationId;
  }

  return supabase
    .from("emcmember")
    .update(updatePayload)
    .eq("id", memberId);
}

export async function POST(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as SpousePayload))) ?? {};
  const memberId = parsePositiveId(payload.memberId);
  const spouseMemberId = parsePositiveId(payload.spouseMemberId);
  if (!memberId || !spouseMemberId) {
    return NextResponse.json({ error: "Select two members." }, { status: 400 });
  }
  if (memberId === spouseMemberId) {
    return NextResponse.json({ error: "A member cannot be their own spouse." }, { status: 400 });
  }
  const memberContact = normalizeContactPatch(payload.memberContact);
  const spouseContact = normalizeContactPatch(payload.spouseContact);

  const supabase = createServiceRoleClient();
  const { rows, error: loadErr } = await loadMembers(supabase, [memberId, spouseMemberId]);
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!rows || rows.length !== 2) {
    return NextResponse.json({ error: "One or both members were not found." }, { status: 404 });
  }

  const member = rows.find((row) => row.id === memberId)!;
  const spouse = rows.find((row) => row.id === spouseMemberId)!;

  if (member.householdid != null || spouse.householdid != null) {
    return NextResponse.json(
      { error: "Both members must not already belong to a household." },
      { status: 400 },
    );
  }
  if (member.spouseid && member.spouseid !== spouseMemberId) {
    return NextResponse.json(
      { error: "Selected member is already linked to a different spouse." },
      { status: 400 },
    );
  }
  if (spouse.spouseid && spouse.spouseid !== memberId) {
    return NextResponse.json(
      { error: "Selected spouse is already linked to a different spouse." },
      { status: 400 },
    );
  }
  if (
    member.congregationid != null &&
    spouse.congregationid != null &&
    member.congregationid !== spouse.congregationid
  ) {
    return NextResponse.json(
      { error: "Both members have different congregations. Resolve congregation assignment first." },
      { status: 400 },
    );
  }

  const householdId = memberId;
  const now = new Date().toISOString();
  const congregationId = member.congregationid ?? spouse.congregationid ?? null;
  const prevMember = {
    spouseid: member.spouseid,
    householdid: member.householdid,
    congregationid: member.congregationid,
    lname: member.lname,
    address: member.address,
    address2: member.address2,
    zip: member.zip,
    city: member.city,
    statecode: member.statecode,
    countrycode: member.countrycode,
    homephone: member.homephone,
    cellphone: member.cellphone,
    statusid: member.statusid,
    tithestatusid: member.tithestatusid,
  };
  const prevSpouse = {
    spouseid: spouse.spouseid,
    householdid: spouse.householdid,
    congregationid: spouse.congregationid,
    lname: spouse.lname,
    address: spouse.address,
    address2: spouse.address2,
    zip: spouse.zip,
    city: spouse.city,
    statecode: spouse.statecode,
    countrycode: spouse.countrycode,
    homephone: spouse.homephone,
    cellphone: spouse.cellphone,
    statusid: spouse.statusid,
    tithestatusid: spouse.tithestatusid,
  };

  const updateMember = await updateMemberSpouse(
    supabase,
    memberId,
    spouseMemberId,
    householdId,
    now,
    memberContact,
    congregationId,
  );
  if (updateMember.error) {
    return NextResponse.json({ error: updateMember.error.message }, { status: 500 });
  }

  const updateSpouse = await updateMemberSpouse(
    supabase,
    spouseMemberId,
    memberId,
    householdId,
    now,
    spouseContact,
    congregationId,
  );
  if (updateSpouse.error) {
    await updateMemberSpouse(
      supabase,
      memberId,
      prevMember.spouseid,
      prevMember.householdid,
      now,
      {
        lname: prevMember.lname,
        address: prevMember.address,
        address2: prevMember.address2,
        zip: prevMember.zip,
        city: prevMember.city,
        statecode: prevMember.statecode,
        countrycode: prevMember.countrycode,
        homephone: prevMember.homephone,
        cellphone: prevMember.cellphone,
        statusid: prevMember.statusid,
        tithestatusid: prevMember.tithestatusid,
      },
      prevMember.congregationid,
    );
    await updateMemberSpouse(
      supabase,
      spouseMemberId,
      prevSpouse.spouseid,
      prevSpouse.householdid,
      now,
      {
        lname: prevSpouse.lname,
        address: prevSpouse.address,
        address2: prevSpouse.address2,
        zip: prevSpouse.zip,
        city: prevSpouse.city,
        statecode: prevSpouse.statecode,
        countrycode: prevSpouse.countrycode,
        homephone: prevSpouse.homephone,
        cellphone: prevSpouse.cellphone,
        statusid: prevSpouse.statusid,
        tithestatusid: prevSpouse.tithestatusid,
      },
      prevSpouse.congregationid,
    );
    return NextResponse.json({ error: updateSpouse.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, householdId });
}

export async function DELETE(request: NextRequest) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as SpousePayload))) ?? {};
  const memberId = parsePositiveId(payload.memberId);
  if (!memberId) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }
  const memberContact = normalizeContactPatch(payload.memberContact);
  const spouseContact = normalizeContactPatch(payload.spouseContact);

  const supabase = createServiceRoleClient();
  const { rows, error: loadErr } = await loadMembers(supabase, [memberId]);
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  const member = rows?.[0] ?? null;
  if (!member) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const explicitSpouseId = parsePositiveId(payload.spouseMemberId);
  const spouseMemberId = explicitSpouseId ?? member.spouseid ?? null;
  const now = new Date().toISOString();

  if (!spouseMemberId) {
    if (!member.spouseid && !member.householdid) {
      return NextResponse.json({ ok: true, alreadyUnlinked: true });
    }

    const clearSolo = await updateMemberSpouse(supabase, memberId, null, null, now, memberContact);
    if (clearSolo.error) {
      return NextResponse.json({ error: clearSolo.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, spouseCleared: false });
  }

  const related = await loadMembers(supabase, [memberId, spouseMemberId]);
  if (related.error) {
    return NextResponse.json({ error: related.error.message }, { status: 500 });
  }

  const currentMember = related.rows?.find((row) => row.id === memberId) ?? null;
  const spouse = related.rows?.find((row) => row.id === spouseMemberId) ?? null;
  if (!currentMember) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }
  if (!spouse) {
    const clearMissingSpouse = await updateMemberSpouse(
      supabase,
      memberId,
      null,
      null,
      now,
      memberContact,
    );
    if (clearMissingSpouse.error) {
      return NextResponse.json({ error: clearMissingSpouse.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, spouseCleared: false });
  }

  const prevMember = {
    spouseid: currentMember.spouseid,
    householdid: currentMember.householdid,
    lname: currentMember.lname,
    address: currentMember.address,
    address2: currentMember.address2,
    zip: currentMember.zip,
    city: currentMember.city,
    statecode: currentMember.statecode,
    countrycode: currentMember.countrycode,
    homephone: currentMember.homephone,
    cellphone: currentMember.cellphone,
    statusid: currentMember.statusid,
    tithestatusid: currentMember.tithestatusid,
  };
  const prevSpouse = {
    spouseid: spouse.spouseid,
    householdid: spouse.householdid,
    lname: spouse.lname,
    address: spouse.address,
    address2: spouse.address2,
    zip: spouse.zip,
    city: spouse.city,
    statecode: spouse.statecode,
    countrycode: spouse.countrycode,
    homephone: spouse.homephone,
    cellphone: spouse.cellphone,
    statusid: spouse.statusid,
    tithestatusid: spouse.tithestatusid,
  };

  const clearMember = await updateMemberSpouse(supabase, memberId, null, null, now, memberContact);
  if (clearMember.error) {
    return NextResponse.json({ error: clearMember.error.message }, { status: 500 });
  }

  const shouldClearSpouse = spouse.spouseid === memberId;
  if (shouldClearSpouse) {
    const clearSpouse = await updateMemberSpouse(
      supabase,
      spouseMemberId,
      null,
      null,
      now,
      spouseContact,
    );
    if (clearSpouse.error) {
      await updateMemberSpouse(
        supabase,
        memberId,
        prevMember.spouseid,
        prevMember.householdid,
        now,
        {
          lname: prevMember.lname,
          address: prevMember.address,
          address2: prevMember.address2,
          zip: prevMember.zip,
          city: prevMember.city,
          statecode: prevMember.statecode,
          countrycode: prevMember.countrycode,
          homephone: prevMember.homephone,
          cellphone: prevMember.cellphone,
          statusid: prevMember.statusid,
          tithestatusid: prevMember.tithestatusid,
        },
      );
      await updateMemberSpouse(
        supabase,
        spouseMemberId,
        prevSpouse.spouseid,
        prevSpouse.householdid,
        now,
        {
          lname: prevSpouse.lname,
          address: prevSpouse.address,
          address2: prevSpouse.address2,
          zip: prevSpouse.zip,
          city: prevSpouse.city,
          statecode: prevSpouse.statecode,
          countrycode: prevSpouse.countrycode,
          homephone: prevSpouse.homephone,
          cellphone: prevSpouse.cellphone,
          statusid: prevSpouse.statusid,
          tithestatusid: prevSpouse.tithestatusid,
        },
      );
      return NextResponse.json({ error: clearSpouse.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    spouseCleared: shouldClearSpouse,
    prevSpouseId: prevSpouse.spouseid,
  });
}
