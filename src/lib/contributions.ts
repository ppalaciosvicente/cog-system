import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/authz";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const CONTRIBUTION_ADMIN_ROLE = "contrib_admin";
export const CONTRIBUTION_USER_ROLE = "contrib_user";
export const CONTRIBUTION_ALLOWED_ROLES = [
  CONTRIBUTION_ADMIN_ROLE,
  CONTRIBUTION_USER_ROLE,
] as const;

export const CONTRIBUTION_FUND_TYPE_NAMES = ["Cash", "Check", "Bank Transfer"] as const;

export const CONTRIBUTION_TYPE_NAMES = [
  "Assistance",
  "2nd Tithe",
  "Feast Deposit",
  "Holy Day Offering",
  "Special Offering",
  "Tithe/Offering",
  "Administrative",
] as const;

export type ContributionDraftInput = {
  memberId: number;
  amount: number;
  fundType: string;
  currencyCode?: string | null;
  checkNo?: string | null;
  contributionType: string;
  dateDeposited: string;
  dateEntered?: string;
  comments?: string | null;
};

export type ContributionRecord = {
  id: number;
  memberId: number;
  memberName: string;
  memberCountryCode: string | null;
  taxDeductible?: boolean | null;
  amount: number;
  fundType: string;
  currencyCode: string;
  checkNo: string | null;
  contributionType: string;
  dateDeposited: string;
  dateEntered: string;
  comments: string | null;
};

type ContributionAccessFailure = {
  ok: false;
  error: string;
  status: number;
};

type ContributionAccessSuccess = {
  ok: true;
  accountId: number;
  memberId: number | null;
  roleNames: string[];
  isAdmin: boolean;
  allowedCountryCodes: string[];
  scopeConfigured: boolean;
  scopeWarning: string | null;
};

export type ContributionAccess = ContributionAccessFailure | ContributionAccessSuccess;

type ContributionStatusRow = {
  id: number;
  name: string | null;
};

const CONTRIBUTION_DONOR_STATUS_TTL_MS = 60_000;
const CONTRIBUTION_DONOR_STATUS_NAMES = new Set([
  "in fellowship",
  "disfellowshipped but tithing",
  "disfellowship but tithing",
  "disfellowedship but tithing",
  "disfellowed but tithing",
  "not yet in fellowship",
]);

let contributionDonorStatusCache:
  | {
      expiresAt: number;
      ids: number[];
    }
  | null = null;

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isMissingRelationError(error: { message?: string | null } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
}

export async function getContributionDonorStatusIds(
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  if (contributionDonorStatusCache && contributionDonorStatusCache.expiresAt > Date.now()) {
    return contributionDonorStatusCache.ids;
  }

  const { data, error } = await supabase
    .from("emcstatus")
    .select("id,name")
    .order("id", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const ids = ((data ?? []) as ContributionStatusRow[])
    .filter((row) => CONTRIBUTION_DONOR_STATUS_NAMES.has(normalizeName(row.name)))
    .map((row) => row.id);

  const nextIds = ids.length > 0 ? ids : [1, 7];
  contributionDonorStatusCache = {
    expiresAt: Date.now() + CONTRIBUTION_DONOR_STATUS_TTL_MS,
    ids: nextIds,
  };
  return nextIds;
}

export function isEligibleContributionDonor(
  member: { statusid: number | null },
  donorStatusIds: number[],
) {
  return donorStatusIds.includes(Number(member.statusid));
}

export async function getContributionAccess(
  request: NextRequest,
): Promise<ContributionAccess> {
  const roleCheck = await requireRole([...CONTRIBUTION_ALLOWED_ROLES], request);
  if (!roleCheck.ok) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const isAdmin = roleCheck.roleNames.includes(CONTRIBUTION_ADMIN_ROLE);
  if (isAdmin) {
    return {
      ok: true,
      accountId: roleCheck.accountId,
      memberId: roleCheck.memberId,
      roleNames: roleCheck.roleNames,
      isAdmin: true,
      allowedCountryCodes: [],
      scopeConfigured: true,
      scopeWarning: null,
    };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contribaccountregion")
    .select("countrycode")
    .eq("accountid", roleCheck.accountId);

  if (error) {
    if (isMissingRelationError(error)) {
      return {
        ok: true,
        accountId: roleCheck.accountId,
        memberId: roleCheck.memberId,
        roleNames: roleCheck.roleNames,
        isAdmin: false,
        allowedCountryCodes: [],
        scopeConfigured: false,
        scopeWarning:
          "Contribution region access is not configured yet because the contribAccountRegion table is not available.",
      };
    }

    return { ok: false, error: error.message, status: 500 };
  }

  const allowedCountryCodes = Array.from(
    new Set(
      (data ?? [])
        .map((row) => normalizeCode(row.countrycode))
        .filter(Boolean),
    ),
  );

  return {
    ok: true,
    accountId: roleCheck.accountId,
    memberId: roleCheck.memberId,
    roleNames: roleCheck.roleNames,
    isAdmin: false,
    allowedCountryCodes,
    scopeConfigured: allowedCountryCodes.length > 0,
    scopeWarning:
      allowedCountryCodes.length > 0
        ? null
        : "No contribution regions are assigned to this account yet.",
  };
}
