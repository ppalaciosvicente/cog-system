import { NextRequest, NextResponse } from "next/server";
import { getContributionAccess } from "@/lib/contributions";
import { createServiceRoleClient } from "@/lib/supabase/service";

type LookupRow = {
  name: string | null;
};

type CurrencyRow = {
  code: string | null;
  name: string | null;
  symbol: string | null;
};

type CountryCurrencyRow = {
  countrycode: string | null;
  currencycode: string | null;
};

type CountryRow = {
  code: string | null;
  name: string | null;
};

type LookupsPayload = {
  fundTypes: string[];
  contributionTypes: string[];
  currencies: Array<{ code: string; name: string; symbol: string }>;
  countryCurrencyByCode: Record<string, string>;
  countries: Array<{ code: string; name: string }>;
  countryNameByCode: Record<string, string>;
};

let lookupsCache: { expiresAt: number; payload: LookupsPayload } | null = null;
const LOOKUPS_CACHE_TTL_MS = 60_000;

function normalizeName(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export async function GET(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (lookupsCache && lookupsCache.expiresAt > Date.now()) {
    return NextResponse.json(lookupsCache.payload);
  }

  const supabase = createServiceRoleClient();
  const [
    { data: fundTypeRows, error: fundTypeErr },
    { data: contributionTypeRows, error: contributionTypeErr },
    { data: currencyRows, error: currencyErr },
    { data: countryCurrencyRows, error: countryCurrencyErr },
    { data: countryRows, error: countryErr },
  ] = await Promise.all([
    supabase.from("contribfundtype").select("name").order("name", { ascending: true }),
    supabase.from("contribtype").select("name").order("name", { ascending: true }),
    supabase.from("contribcurrency").select("code,name,symbol").order("code", { ascending: true }),
    supabase.from("contribcountrycurrency").select("countrycode,currencycode"),
    supabase.from("emccountry").select("code,name"),
  ]);

  if (fundTypeErr) {
    return NextResponse.json({ error: fundTypeErr.message }, { status: 500 });
  }
  if (contributionTypeErr) {
    return NextResponse.json({ error: contributionTypeErr.message }, { status: 500 });
  }
  if (currencyErr) {
    return NextResponse.json({ error: currencyErr.message }, { status: 500 });
  }
  if (countryCurrencyErr) {
    return NextResponse.json({ error: countryCurrencyErr.message }, { status: 500 });
  }
  if (countryErr) {
    return NextResponse.json({ error: countryErr.message }, { status: 500 });
  }

  const fundTypes = ((fundTypeRows ?? []) as LookupRow[])
    .map((row) => normalizeName(row.name))
    .filter(Boolean);
  const contributionTypes = ((contributionTypeRows ?? []) as LookupRow[])
    .map((row) => normalizeName(row.name))
    .filter(Boolean);
  const currencies = ((currencyRows ?? []) as CurrencyRow[])
    .map((row) => ({
      code: normalizeCode(row.code),
      name: normalizeName(row.name),
      symbol: normalizeName(row.symbol),
    }))
    .filter((row) => row.code && row.name);
  const countryCurrencyByCode = Object.fromEntries(
    ((countryCurrencyRows ?? []) as CountryCurrencyRow[])
      .map((row) => [normalizeCode(row.countrycode), normalizeCode(row.currencycode)] as const)
      .filter(([countryCode, currencyCode]) => countryCode && currencyCode),
  );
  const countries = ((countryRows ?? []) as CountryRow[])
    .map((row) => ({ code: normalizeCode(row.code), name: normalizeName(row.name) }))
    .filter((row) => row.code && row.name);
  const countryNameByCode = Object.fromEntries(countries.map((row) => [row.code, row.name]));

  const payload: LookupsPayload = {
    fundTypes,
    contributionTypes,
    currencies,
    countryCurrencyByCode,
    countryNameByCode,
    countries: (access.isAdmin
      ? countries
      : countries.filter((row) => access.allowedCountryCodes.includes(row.code))
    ).sort((a, b) => a.name.localeCompare(b.name)),
  };
  lookupsCache = {
    expiresAt: Date.now() + LOOKUPS_CACHE_TTL_MS,
    payload,
  };

  return NextResponse.json(payload);
}
