import { createServiceRoleClient } from "@/lib/supabase/service";

const COUNTRY_CACHE_TTL_MS = 300_000;

let allCountryNamesCache: { expiresAt: number; nameByCode: Map<string, string> } | null = null;

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

async function loadAllCountryNames(
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  if (allCountryNamesCache && allCountryNamesCache.expiresAt > Date.now()) {
    return allCountryNamesCache.nameByCode;
  }

  const { data, error } = await supabase.from("emccountry").select("code,name");
  if (error) {
    throw new Error(error.message);
  }

  const nameByCode = new Map<string, string>();
  for (const row of data ?? []) {
    const code = normalizeCode(row.code);
    const name = String(row.name ?? "").trim();
    if (code && name) {
      nameByCode.set(code, name);
    }
  }

  allCountryNamesCache = {
    expiresAt: Date.now() + COUNTRY_CACHE_TTL_MS,
    nameByCode,
  };
  return nameByCode;
}

export async function getCountryNameByCodeMap(
  supabase: ReturnType<typeof createServiceRoleClient>,
) {
  return loadAllCountryNames(supabase);
}

export async function getCountryNamesForCodes(
  supabase: ReturnType<typeof createServiceRoleClient>,
  codes: string[],
) {
  const nameByCode = await loadAllCountryNames(supabase);
  return codes.map((code) => nameByCode.get(normalizeCode(code)) ?? code);
}

