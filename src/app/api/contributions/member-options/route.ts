import { NextRequest, NextResponse } from "next/server";
import { buildHouseholdOptions } from "@/lib/households";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getContributionAccess, getContributionDonorStatusIds } from "@/lib/contributions";

type ContributionMemberOption = {
  id: number;
  fname: string | null;
  lname: string | null;
  countrycode: string | null;
  statecode: string | null;
  householdid: number | null;
  spouseid: number | null;
};

type CountryCurrencyRow = {
  countrycode: string | null;
  currencycode: string | null;
};

type MemberOptionsPayload = {
  members: ContributionMemberOption[];
  households: ReturnType<typeof buildHouseholdOptions<ContributionMemberOption>>;
  householdDefaultCurrencyByRepresentative: Record<string, string>;
  warning: string | null;
};

type CachedMemberOptions = {
  expiresAt: number;
  payload: MemberOptionsPayload;
};

const memberOptionsCache = new Map<string, CachedMemberOptions>();
const MEMBER_OPTIONS_CACHE_TTL_MS = 30_000;

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

export async function GET(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!access.isAdmin && access.allowedCountryCodes.length === 0) {
    return NextResponse.json({
      members: [],
      warning: access.scopeWarning,
    });
  }

  const key = cacheKey(access);
  const cached = memberOptionsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }

  const supabase = createServiceRoleClient();
  let donorStatusIds: number[] = [];
  try {
    donorStatusIds = await getContributionDonorStatusIds(supabase);
  } catch (loadError) {
    return NextResponse.json(
      { error: loadError instanceof Error ? loadError.message : "Failed to load statuses." },
      { status: 500 },
    );
  }
  let query = supabase
    .from("emcmember")
    .select("id,fname,lname,countrycode,statecode,householdid,spouseid")
    .in("statusid", donorStatusIds)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true })
    .limit(2000);

  if (!access.isAdmin) {
    query = query.in("countrycode", access.allowedCountryCodes);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const members = (data ?? []) as ContributionMemberOption[];
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
    return NextResponse.json({ error: countryCurrencyErr.message }, { status: 500 });
  }
  const currencyByCountry = new Map<string, string>(
    ((countryCurrencyRows ?? []) as CountryCurrencyRow[])
      .map((row) => [normalizeCode(row.countrycode), normalizeCode(row.currencycode)] as const)
      .filter(([countryCode, currencyCode]) => countryCode && currencyCode),
  );
  const householdDefaultCurrencyByRepresentative = Object.fromEntries(
    households.map((household) => {
      const countryCode = representativeCountryById.get(household.value) ?? "";
      return [String(household.value), currencyByCountry.get(countryCode) ?? "USD"] as const;
    }),
  );

  const payload: MemberOptionsPayload = {
    members,
    households,
    householdDefaultCurrencyByRepresentative,
    warning: access.scopeWarning,
  };
  memberOptionsCache.set(key, {
    expiresAt: Date.now() + MEMBER_OPTIONS_CACHE_TTL_MS,
    payload,
  });

  return NextResponse.json(payload);
}
