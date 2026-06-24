import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

type DeletePayload = {
  confirmAccountDelete?: boolean;
};

type MemberDeleteRow = {
  id: number;
  spouseid: number | null;
  householdid: number | null;
};

type AccountRow = {
  id: number;
  isactive: boolean | null;
};

function parsePositiveId(value: string | undefined) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function deleteError(error: { message: string } | null) {
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : null;
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const roleCheck = await requireRole(["emc_admin"], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: idParam } = await context.params;
  const memberId = parsePositiveId(idParam);
  if (!memberId) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  if (roleCheck.memberId === memberId) {
    return NextResponse.json(
      { error: "You cannot delete the member linked to your own account." },
      { status: 400 },
    );
  }

  const payload = (await request.json().catch(() => ({} as DeletePayload))) ?? {};
  const supabase = createServiceRoleClient();

  const { data: memberData, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,spouseid,householdid")
    .eq("id", memberId)
    .limit(1);
  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  const member = ((memberData ?? []) as MemberDeleteRow[])[0] ?? null;
  if (!member) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const { count: contributionCount, error: contributionErr } = await supabase
    .from("contribcontribution")
    .select("id", { count: "exact", head: true })
    .or(`memberid.eq.${memberId},contributorid.eq.${memberId}`);
  if (contributionErr) {
    return NextResponse.json({ error: contributionErr.message }, { status: 500 });
  }
  if ((contributionCount ?? 0) > 0) {
    return NextResponse.json(
      { error: "This member can't be deleted because contributions are associated with them." },
      { status: 400 },
    );
  }

  const { count: householdReferenceCount, error: householdReferenceErr } = await supabase
    .from("emcmember")
    .select("id", { count: "exact", head: true })
    .or(`spouseid.eq.${memberId},householdid.eq.${memberId}`);
  if (householdReferenceErr) {
    return NextResponse.json({ error: householdReferenceErr.message }, { status: 500 });
  }
  if (member.householdid != null || member.spouseid != null || (householdReferenceCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This member belongs to a household. Unlink the household/spouse relationship before deleting this member.",
      },
      { status: 400 },
    );
  }

  const { count: elderAreaCount, error: elderAreaErr } = await supabase
    .from("emcelderarea")
    .select("id", { count: "exact", head: true })
    .eq("memberid", memberId);
  if (elderAreaErr) {
    return NextResponse.json({ error: elderAreaErr.message }, { status: 500 });
  }
  if ((elderAreaCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This member is an elder with areas of responsibility assigned to him/her. Please remove those assignments first and delete the member afterwards.",
      },
      { status: 400 },
    );
  }

  const { data: accountData, error: accountErr } = await supabase
    .from("emcaccounts")
    .select("id,isactive")
    .eq("memberid", memberId);
  if (accountErr) {
    return NextResponse.json({ error: accountErr.message }, { status: 500 });
  }
  const accounts = (accountData ?? []) as AccountRow[];
  const hasActiveAccount = accounts.some((account) => account.isactive);
  if (hasActiveAccount && !payload.confirmAccountDelete) {
    return NextResponse.json(
      {
        code: "active_account",
        error:
          "This member has an active EMC account linked to them. Are you sure you want to delete both the member and the associated account?",
      },
      { status: 409 },
    );
  }

  const { data: fotRegData, error: fotRegErr } = await supabase
    .from("fotreg")
    .select("id")
    .eq("memberid", memberId);
  if (fotRegErr) {
    return NextResponse.json({ error: fotRegErr.message }, { status: 500 });
  }
  const fotRegIds = ((fotRegData ?? []) as Array<{ id: number | string | null }>)
    .map((row) => row.id)
    .filter((id): id is number | string => id != null);

  if (fotRegIds.length > 0) {
    const individualDelete = await supabase
      .from("fotregindividual")
      .delete()
      .in("fotregid", fotRegIds);
    const individualDeleteError = deleteError(individualDelete.error);
    if (individualDeleteError) return individualDeleteError;
  }

  const fotRegDelete = await supabase.from("fotreg").delete().eq("memberid", memberId);
  const fotRegDeleteError = deleteError(fotRegDelete.error);
  if (fotRegDeleteError) return fotRegDeleteError;

  const tokenDelete = await supabase.from("fotregtoken").delete().eq("memberid", memberId);
  const tokenDeleteError = deleteError(tokenDelete.error);
  if (tokenDeleteError) return tokenDeleteError;

  const accountIds = accounts
    .map((account) => account.id)
    .filter((id): id is number => Number.isFinite(id) && id > 0);

  if (accountIds.length > 0) {
    const scopeDelete = await supabase
      .from("contribaccountregion")
      .delete()
      .in("accountid", accountIds);
    const scopeDeleteError = deleteError(scopeDelete.error);
    if (scopeDeleteError) return scopeDeleteError;

    const roleDelete = await supabase
      .from("emcaccountroles")
      .delete()
      .in("accountid", accountIds);
    const roleDeleteError = deleteError(roleDelete.error);
    if (roleDeleteError) return roleDeleteError;

    const accountDelete = await supabase.from("emcaccounts").delete().in("id", accountIds);
    const accountDeleteError = deleteError(accountDelete.error);
    if (accountDeleteError) return accountDeleteError;
  }

  const memberDelete = await supabase.from("emcmember").delete().eq("id", memberId);
  const memberDeleteError = deleteError(memberDelete.error);
  if (memberDeleteError) return memberDeleteError;

  return NextResponse.json({ ok: true });
}
