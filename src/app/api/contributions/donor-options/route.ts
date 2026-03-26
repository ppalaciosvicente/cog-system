import { NextRequest, NextResponse } from "next/server";
import { buildHouseholdOptions } from "@/lib/households";
import { getContributionAccess, getContributionDonorStatusIds } from "@/lib/contributions";
import { createServiceRoleClient } from "@/lib/supabase/service";

type DonorMemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  countrycode: string | null;
  statecode: string | null;
  householdid: number | null;
  spouseid: number | null;
  baptized?: boolean | null;
  statusid?: number | null;
};

type CountryCurrencyRow = {
  countrycode: string | null;
  currencycode: string | null;
};

type DonorHouseholdOption = ReturnType<typeof buildHouseholdOptions<DonorMemberRow>>[number] & {
  defaultCurrencyCode: string;
};

type CachedDonorOptions = {
  expiresAt: number;
  households: DonorHouseholdOption[];
};

const donorOptionsCache = new Map<string, CachedDonorOptions>();
const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;
const MAX_MEMBER_ROWS = 10_000;

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function cacheKey(access: Extract<Awaited<ReturnType<typeof getContributionAccess>>, { ok: true }>) {
  return JSON.stringify({
    accountId: access.accountId,
    isAdmin: access.isAdmin,
    countries: access.allowedCountryCodes,
  });
}

function applyScopeFilters(
  query: ReturnType<ReturnType<typeof createServiceRoleClient>["from"]>,
  access: Extract<Awaited<ReturnType<typeof getContributionAccess>>, { ok: true }>,
  donorStatusIds: number[],
) {
  let scopedQuery = query.in("statusid", donorStatusIds as number[]);
  if (!access.isAdmin) {
    scopedQuery = scopedQuery.in("countrycode", access.allowedCountryCodes as string[]);
  }
  return scopedQuery;
}

async function buildHouseholdsWithCurrency(
  supabase: ReturnType<typeof createServiceRoleClient>,
  members: DonorMemberRow[],
) {
  const households = buildHouseholdOptions(members);
  const representativeCountryById = new Map<number, string>();
  members.forEach((member) => {
    representativeCountryById.set(member.id, normalizeCode(member.countrycode));
  });

  const countries = Array.from(
    new Set(
      members
        .map((member) => normalizeCode(member.countrycode))
        .filter(Boolean),
    ),
  );

  const { data: countryCurrencyRows, error: countryCurrencyErr } = await supabase
    .from("contribcountrycurrency")
    .select("countrycode,currencycode")
    .in("countrycode", countries.length ? countries : ["__none__"]);
  if (countryCurrencyErr) {
    throw new Error(countryCurrencyErr.message);
  }

  const currencyByCountry = new Map<string, string>(
    ((countryCurrencyRows ?? []) as CountryCurrencyRow[])
      .map((row) => [normalizeCode(row.countrycode), normalizeCode(row.currencycode)] as const)
      .filter(([countryCode, currencyCode]) => countryCode && currencyCode),
  );

  return households.map((household) => ({
    ...household,
    defaultCurrencyCode:
      currencyByCountry.get(representativeCountryById.get(household.value) ?? "") ?? "USD",
  }));
}

export async function GET(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchTerm = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? "25") || 25, 50);

  if (searchTerm.length >= 2) {
    const supabase = createServiceRoleClient();
    let donorStatusIds: number[] = [];
    try {
      donorStatusIds = await getContributionDonorStatusIds(supabase);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to load statuses." },
        { status: 500 },
      );
    }
    const normalizedSearch = searchTerm.replace(/[,%]+/g, " ").trim();
    const searchTokens = normalizedSearch
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 2);

    if (!searchTokens.length) {
      return NextResponse.json({ households: [], warning: access.scopeWarning });
    }

    let searchQuery = applyScopeFilters(
      supabase
        .from("emcmember")
        .select("id,fname,lname,countrycode,statecode,householdid,spouseid")
        .order("lname", { ascending: true })
        .order("fname", { ascending: true })
        .limit(limit),
      access,
      donorStatusIds,
    );

    searchTokens.forEach((token) => {
      const escapedToken = token.replace(/[%_]/g, "\\$&");
      searchQuery = searchQuery.or(`fname.ilike.%${escapedToken}%,lname.ilike.%${escapedToken}%`);
    });

    const { data: matchedRows, error: matchedErr } = await searchQuery;
    if (matchedErr) {
      return NextResponse.json({ error: matchedErr.message }, { status: 500 });
    }

    const matchedMembers = (matchedRows ?? []) as DonorMemberRow[];
    if (!matchedMembers.length) {
      return NextResponse.json({ households: [], warning: access.scopeWarning });
    }

    const memberIds = Array.from(new Set(matchedMembers.map((row) => row.id)));
    const spouseIds = Array.from(
      new Set(matchedMembers.map((row) => row.spouseid).filter((value): value is number => value != null)),
    );
    const householdIds = Array.from(
      new Set(matchedMembers.map((row) => row.householdid).filter((value): value is number => value != null)),
    );
    const expandedMembers = new Map<number, DonorMemberRow>();
    matchedMembers.forEach((member) => expandedMembers.set(member.id, member));

    if (householdIds.length > 0) {
      const householdQuery = applyScopeFilters(
        supabase
          .from("emcmember")
          .select("id,fname,lname,countrycode,statecode,householdid,spouseid")
          .in("householdid", householdIds)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true }),
        access,
        donorStatusIds,
      );
      const { data: householdRows, error: householdErr } = await householdQuery;
      if (householdErr) {
        return NextResponse.json({ error: householdErr.message }, { status: 500 });
      }

      ((householdRows ?? []) as DonorMemberRow[]).forEach((member) => {
        expandedMembers.set(member.id, member);
      });
    }

    const extraIds = spouseIds.filter((id) => !memberIds.includes(id));
    if (extraIds.length > 0) {
      const spouseQuery = applyScopeFilters(
        supabase
          .from("emcmember")
          .select("id,fname,lname,countrycode,statecode,householdid,spouseid")
          .in("id", extraIds)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true }),
        access,
        donorStatusIds,
      );
      const { data: spouseRows, error: spouseErr } = await spouseQuery;
      if (spouseErr) {
        return NextResponse.json({ error: spouseErr.message }, { status: 500 });
      }

      ((spouseRows ?? []) as DonorMemberRow[]).forEach((member) => {
        expandedMembers.set(member.id, member);
      });
    }

    try {
      return NextResponse.json({
        households: await buildHouseholdsWithCurrency(supabase, [...expandedMembers.values()]),
        warning: access.scopeWarning,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to load donors." },
        { status: 500 },
      );
    }
  }

  const key = cacheKey(access);
  const cached = donorOptionsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ households: cached.households, warning: access.scopeWarning });
  }

  const supabase = createServiceRoleClient();
  let donorStatusIds: number[] = [];
  try {
    donorStatusIds = await getContributionDonorStatusIds(supabase);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load statuses." },
      { status: 500 },
    );
  }
  const eligibleMembers: DonorMemberRow[] = [];
  for (let from = 0; from < MAX_MEMBER_ROWS; from += PAGE_SIZE) {
    const eligibleMemberQuery = applyScopeFilters(
      supabase
        .from("emcmember")
        .select("id,fname,lname,countrycode,statecode,householdid,spouseid")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1),
      access,
      donorStatusIds,
    );

    const { data: eligibleMemberRows, error: eligibleMemberErr } = await eligibleMemberQuery;
    if (eligibleMemberErr) {
      return NextResponse.json({ error: eligibleMemberErr.message }, { status: 500 });
    }

    const pageRows = (eligibleMemberRows ?? []) as DonorMemberRow[];
    eligibleMembers.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) {
      break;
    }
  }

  if (!eligibleMembers.length) {
    return NextResponse.json({ households: [], warning: access.scopeWarning });
  }

  let households: DonorHouseholdOption[];
  try {
    households = await buildHouseholdsWithCurrency(supabase, eligibleMembers);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load donors." },
      { status: 500 },
    );
  }
  donorOptionsCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    households,
  });

  return NextResponse.json({
    households,
    warning: access.scopeWarning,
  });
}
