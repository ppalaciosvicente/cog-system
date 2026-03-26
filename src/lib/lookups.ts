import { createClient, getAuthHeaders } from "@/lib/supabase/client";
import type { CountryRow, StateRow } from "@/types/lookups";

export type Option = { value: string; label: string };

function buildLookups(countries: CountryRow[], states: StateRow[]) {
  const countryNameByCode: Record<string, string> = {};
  for (const row of countries) {
    const code = String(row.code ?? "")
      .trim()
      .toUpperCase();
    const name = String(row.name ?? "").trim();
    if (code && name) countryNameByCode[code] = name;
  }

  const usStateNameByCode: Record<string, string> = {};
  const canadaStateNameByCode: Record<string, string> = {};
  const australiaStateNameByCode: Record<string, string> = {};
  for (const row of states) {
    const code = String(row.code ?? "")
      .trim()
      .toUpperCase();
    const name = String(row.name ?? "").trim();
    const country = String(row.countrycode ?? "")
      .trim()
      .toUpperCase();
    if (!code || !name) continue;
    if (country === "CA") canadaStateNameByCode[code] = name;
    else if (country === "US") usStateNameByCode[code] = name;
    else if (country === "AU") australiaStateNameByCode[code] = name;
  }

  const countryOptions: Option[] = Object.entries(countryNameByCode)
    .map(([code, name]) => ({ value: code, label: `${name} (${code})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const usStateOptions: Option[] = Object.entries(usStateNameByCode)
    .map(([code, name]) => ({ value: code, label: `${name} (${code})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const canadaStateOptions: Option[] = Object.entries(canadaStateNameByCode)
    .map(([code, name]) => ({ value: code, label: `${name} (${code})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const australiaStateOptions: Option[] = Object.entries(australiaStateNameByCode)
    .map(([code, name]) => ({ value: code, label: `${name} (${code})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    countryNameByCode,
    usStateNameByCode,
    canadaStateNameByCode,
    australiaStateNameByCode,
    countryOptions,
    usStateOptions,
    canadaStateOptions,
    australiaStateOptions,
  };
}

export async function fetchCountryAndUSStateLookups() {
  const supabase = createClient();

  let countries: CountryRow[] = [];
  let states: StateRow[] = [];

  const [{ data: countriesData, error: cErr }, { data: statesData, error: sErr }] = await Promise.all([
    supabase.from("emccountry").select("code,name"),
    supabase.from("emcstate").select("code,name,countrycode"),
  ]);

  countries = (countriesData ?? []) as CountryRow[];
  states = (statesData ?? []) as StateRow[];

  if (cErr || sErr || countries.length === 0 || states.length === 0) {
    const fallback = await fetch("/api/lookups/location", {
      method: "GET",
      headers: await getAuthHeaders(),
    });
    const payload = await fallback.json().catch(() => ({}));
    if (!fallback.ok) {
      if (cErr) throw new Error(`Failed to load countries: ${cErr.message}`);
      if (sErr) throw new Error(`Failed to load states: ${sErr.message}`);
      const message =
        typeof payload?.error === "string" ? payload.error : "Failed to load lookups.";
      throw new Error(message);
    }
    countries = Array.isArray(payload?.countries) ? (payload.countries as CountryRow[]) : [];
    states = Array.isArray(payload?.states) ? (payload.states as StateRow[]) : [];
  }

  return buildLookups(countries, states);
}
