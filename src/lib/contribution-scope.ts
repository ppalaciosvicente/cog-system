import type { ContributionAccess } from "@/lib/contributions";
import { createServiceRoleClient } from "@/lib/supabase/service";

type ContributionScopeAccess = Extract<ContributionAccess, { ok: true }>;

export type ContributionScopeSummary = {
  countryNames: string[];
  label: string;
};

const SCOPE_CACHE_TTL_MS = 300_000;
const scopeSummaryCache = new Map<string, { expiresAt: number; value: ContributionScopeSummary }>();

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export async function getContributionScopeSummary(
  access: ContributionScopeAccess,
): Promise<ContributionScopeSummary> {
  const cacheKey = access.isAdmin
    ? "admin"
    : access.allowedCountryCodes
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .join("|");
  const cached = scopeSummaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (access.isAdmin) {
    const value = {
      countryNames: [],
      label: "All countries",
    };
    scopeSummaryCache.set(cacheKey, { expiresAt: Date.now() + SCOPE_CACHE_TTL_MS, value });
    return value;
  }

  if (!access.allowedCountryCodes.length) {
    const value = {
      countryNames: [],
      label: "No countries assigned",
    };
    scopeSummaryCache.set(cacheKey, { expiresAt: Date.now() + SCOPE_CACHE_TTL_MS, value });
    return value;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("emccountry")
    .select("code,name")
    .in("code", access.allowedCountryCodes);

  if (error) {
    const value = {
      countryNames: access.allowedCountryCodes,
      label: access.allowedCountryCodes.join(", "),
    };
    scopeSummaryCache.set(cacheKey, { expiresAt: Date.now() + SCOPE_CACHE_TTL_MS, value });
    return value;
  }

  const countryNameByCode = new Map<string, string>();
  for (const row of data ?? []) {
    const code = normalizeCode(row.code);
    const name = String(row.name ?? "").trim();
    if (code && name) {
      countryNameByCode.set(code, name);
    }
  }

  const countryNames = access.allowedCountryCodes.map(
    (code) => countryNameByCode.get(code) ?? code,
  );

  const value = {
    countryNames,
    label: countryNames.join(", "),
  };
  scopeSummaryCache.set(cacheKey, { expiresAt: Date.now() + SCOPE_CACHE_TTL_MS, value });
  return value;
}
