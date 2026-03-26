import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import {
  CONTRIBUTION_ADMIN_ROLE,
  CONTRIBUTION_USER_ROLE,
} from "@/lib/contributions";
import { createServiceRoleClient } from "@/lib/supabase/service";

type CountryRow = {
  code: string | null;
  name: string | null;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
};

type AccountRow = {
  id: number;
  memberid: number | null;
  isactive: boolean | null;
};

type AccountRoleRow = {
  accountid: number | null;
  roleid: number | null;
};

type RoleRow = {
  id: number;
  rolename: string | null;
};

type RegionRow = {
  accountid: number | null;
  countrycode: string | null;
};

type UpdatePayload = {
  memberId?: number;
  roleName?: string | null;
  countryCodes?: string[] | null;
};

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeRoleName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function displayName(member: MemberRow) {
  const ln = String(member.lname ?? "").trim();
  const fn = String(member.fname ?? "").trim();
  if (!ln && !fn) return `#${member.id}`;
  if (!ln) return fn;
  if (!fn) return ln;
  return `${ln}, ${fn}`;
}

function highestContributionRole(roleNames: string[]) {
  if (roleNames.includes(CONTRIBUTION_ADMIN_ROLE)) return CONTRIBUTION_ADMIN_ROLE;
  if (roleNames.includes(CONTRIBUTION_USER_ROLE)) return CONTRIBUTION_USER_ROLE;
  return null;
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole([CONTRIBUTION_ADMIN_ROLE], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceRoleClient();
  const [
    { data: roleData, error: roleErr },
    { data: countryData, error: countryErr },
    { data: accountData, error: accountErr },
  ] = await Promise.all([
    supabase
      .from("emcroles")
      .select("id,rolename")
      .in("rolename", [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]),
    supabase.from("emccountry").select("code,name").order("name", { ascending: true }),
    supabase.from("emcaccounts").select("id,memberid,isactive").eq("isactive", true),
  ]);

  if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 });
  if (countryErr) return NextResponse.json({ error: countryErr.message }, { status: 500 });
  if (accountErr) return NextResponse.json({ error: accountErr.message }, { status: 500 });

  const roleIdByName = new Map<string, number>();
  ((roleData ?? []) as RoleRow[]).forEach((row) => {
    const name = normalizeRoleName(row.rolename);
    if (!name || !Number.isFinite(row.id) || row.id <= 0) return;
    roleIdByName.set(name, row.id);
  });

  const contribRoleIds = [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]
    .map((roleName) => roleIdByName.get(roleName))
    .filter((id): id is number => Number.isFinite(id) && id > 0);

  const accounts = ((accountData ?? []) as AccountRow[]).filter(
    (row) => Number.isFinite(row.id) && row.id > 0 && Number.isFinite(row.memberid) && (row.memberid ?? 0) > 0,
  );
  const accountIds = accounts.map((row) => row.id);
  const memberIds = accounts.map((row) => Number(row.memberid));

  const [
    { data: memberData, error: memberErr },
    { data: accountRoleData, error: accountRoleErr },
    { data: regionData, error: regionErr },
  ] = await Promise.all([
    memberIds.length
      ? supabase
          .from("emcmember")
          .select("id,fname,lname")
          .in("id", memberIds)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true })
      : Promise.resolve({ data: [] as MemberRow[], error: null }),
    accountIds.length && contribRoleIds.length
      ? supabase
          .from("emcaccountroles")
          .select("accountid,roleid")
          .in("accountid", accountIds)
          .in("roleid", contribRoleIds)
      : Promise.resolve({ data: [] as AccountRoleRow[], error: null }),
    accountIds.length
      ? supabase.from("contribaccountregion").select("accountid,countrycode").in("accountid", accountIds)
      : Promise.resolve({ data: [] as RegionRow[], error: null }),
  ]);

  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (accountRoleErr) return NextResponse.json({ error: accountRoleErr.message }, { status: 500 });
  if (regionErr) return NextResponse.json({ error: regionErr.message }, { status: 500 });

  const accountIdByMemberId = new Map<number, number>();
  accounts.forEach((row) => {
    const memberId = Number(row.memberid);
    if (!accountIdByMemberId.has(memberId)) {
      accountIdByMemberId.set(memberId, row.id);
    }
  });

  const roleNameByRoleId = new Map<number, string>();
  roleIdByName.forEach((roleId, roleName) => {
    roleNameByRoleId.set(roleId, roleName);
  });

  const roleNamesByAccountId = new Map<number, string[]>();
  ((accountRoleData ?? []) as AccountRoleRow[]).forEach((row) => {
    const accountId = Number(row.accountid);
    const roleId = Number(row.roleid);
    if (!Number.isFinite(accountId) || accountId <= 0) return;
    const roleName = roleNameByRoleId.get(roleId);
    if (!roleName) return;
    const current = roleNamesByAccountId.get(accountId) ?? [];
    current.push(roleName);
    roleNamesByAccountId.set(accountId, current);
  });

  const countryCodesByAccountId = new Map<number, string[]>();
  ((regionData ?? []) as RegionRow[]).forEach((row) => {
    const accountId = Number(row.accountid);
    if (!Number.isFinite(accountId) || accountId <= 0) return;
    const code = normalizeCode(row.countrycode);
    if (!code) return;
    const current = countryCodesByAccountId.get(accountId) ?? [];
    if (!current.includes(code)) current.push(code);
    countryCodesByAccountId.set(accountId, current);
  });

  const membersById = new Map<number, MemberRow>();
  ((memberData ?? []) as MemberRow[]).forEach((row) => {
    membersById.set(row.id, row);
  });

  const rows = Array.from(accountIdByMemberId.entries())
    .map(([memberId, accountId]) => {
      const member = membersById.get(memberId);
      if (!member) return null;
      return {
        memberId,
        accountId,
        memberName: displayName(member),
        roleName: highestContributionRole(roleNamesByAccountId.get(accountId) ?? []),
        countryCodes: (countryCodesByAccountId.get(accountId) ?? []).sort((a, b) => a.localeCompare(b)),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.memberName.localeCompare(b.memberName));

  const countryOptions = ((countryData ?? []) as CountryRow[])
    .map((row) => {
      const code = normalizeCode(row.code);
      const name = String(row.name ?? "").trim();
      if (!code || !name) return null;
      return { code, name };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return NextResponse.json({ rows, countryOptions });
}

export async function PUT(request: NextRequest) {
  const roleCheck = await requireRole([CONTRIBUTION_ADMIN_ROLE], request);
  if (!roleCheck.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({} as UpdatePayload))) ?? {};
  const memberId = Number(payload.memberId);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing member id." }, { status: 400 });
  }

  const roleName = normalizeRoleName(payload.roleName);
  if (roleName && roleName !== CONTRIBUTION_ADMIN_ROLE && roleName !== CONTRIBUTION_USER_ROLE) {
    return NextResponse.json({ error: "Invalid contributions role." }, { status: 400 });
  }

  const countryCodes = Array.from(
    new Set((payload.countryCodes ?? []).map((code) => normalizeCode(code)).filter(Boolean)),
  );
  if (roleName === CONTRIBUTION_USER_ROLE && countryCodes.length === 0) {
    return NextResponse.json(
      { error: "At least one country is required for contrib_user." },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: accountRows, error: accountErr } = await supabase
    .from("emcaccounts")
    .select("id,memberid,isactive")
    .eq("memberid", memberId)
    .eq("isactive", true)
    .order("id", { ascending: false })
    .limit(1);

  if (accountErr) return NextResponse.json({ error: accountErr.message }, { status: 500 });
  const accountId = Number((accountRows as AccountRow[] | null)?.[0]?.id ?? 0);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return NextResponse.json(
      { error: "No active account found for this member." },
      { status: 400 },
    );
  }

  const { data: roleData, error: roleErr } = await supabase
    .from("emcroles")
    .select("id,rolename")
    .in("rolename", [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]);
  if (roleErr) return NextResponse.json({ error: roleErr.message }, { status: 500 });

  const roleIdByName = new Map<string, number>();
  ((roleData ?? []) as RoleRow[]).forEach((row) => {
    const normalized = normalizeRoleName(row.rolename);
    if (!normalized || !Number.isFinite(row.id) || row.id <= 0) return;
    roleIdByName.set(normalized, row.id);
  });
  const managedRoleIds = [CONTRIBUTION_ADMIN_ROLE, CONTRIBUTION_USER_ROLE]
    .map((name) => roleIdByName.get(name))
    .filter((id): id is number => Number.isFinite(id) && id > 0);

  const { error: deleteRoleErr } = await supabase
    .from("emcaccountroles")
    .delete()
    .eq("accountid", accountId)
    .in("roleid", managedRoleIds);
  if (deleteRoleErr) {
    return NextResponse.json({ error: deleteRoleErr.message }, { status: 500 });
  }

  if (roleName) {
    const roleId = roleIdByName.get(roleName);
    if (!roleId) {
      return NextResponse.json({ error: `Role ${roleName} was not found.` }, { status: 500 });
    }
    const { error: insertRoleErr } = await supabase
      .from("emcaccountroles")
      .insert({ accountid: accountId, roleid: roleId });
    if (insertRoleErr) {
      return NextResponse.json({ error: insertRoleErr.message }, { status: 500 });
    }
  }

  const { error: deleteScopeErr } = await supabase
    .from("contribaccountregion")
    .delete()
    .eq("accountid", accountId);
  if (deleteScopeErr) {
    return NextResponse.json({ error: deleteScopeErr.message }, { status: 500 });
  }

  if (roleName === CONTRIBUTION_USER_ROLE && countryCodes.length > 0) {
    const nowIso = new Date().toISOString();
    const scopeRows = countryCodes.map((code) => ({
      accountid: accountId,
      countrycode: code,
      datecreated: nowIso,
      dateupdated: nowIso,
    }));
    const { error: insertScopeErr } = await supabase
      .from("contribaccountregion")
      .insert(scopeRows);
    if (insertScopeErr) {
      return NextResponse.json({ error: insertScopeErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
