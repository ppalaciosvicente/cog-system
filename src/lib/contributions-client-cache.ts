import { getAuthHeaders } from "@/lib/supabase/client";

export type ContributionHouseholdOption = {
  value: number;
  label: string;
  memberIds: number[];
};

export type ContributionCurrencyOption = {
  code: string;
  name: string;
  symbol: string;
};

export type ContributionLookupsPayload = {
  fundTypes?: string[];
  contributionTypes?: string[];
  currencies?: ContributionCurrencyOption[];
  countryCurrencyByCode?: Record<string, string>;
  countries?: Array<{ code: string; name: string }>;
  countryNameByCode?: Record<string, string>;
};

export type ContributionMemberOptionsPayload = {
  households?: ContributionHouseholdOption[];
  householdDefaultCurrencyByRepresentative?: Record<string, string>;
  warning?: string | null;
};

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

const LOOKUPS_TTL_MS = 60_000;
const MEMBER_OPTIONS_TTL_MS = 30_000;

const lookupCacheByAuth = new Map<string, CachedValue<ContributionLookupsPayload>>();
const memberOptionsCacheByAuth = new Map<string, CachedValue<ContributionMemberOptionsPayload>>();
const lookupInflightByAuth = new Map<string, Promise<ContributionLookupsPayload>>();
const memberOptionsInflightByAuth = new Map<string, Promise<ContributionMemberOptionsPayload>>();

function authCacheKey(headers: Record<string, string>) {
  return headers.Authorization ?? "__anon__";
}

export async function getContributionLookupsCached() {
  const headers = await getAuthHeaders();
  const key = authCacheKey(headers);
  const cached = lookupCacheByAuth.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflight = lookupInflightByAuth.get(key);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const response = await fetch("/api/contributions/lookups", {
      credentials: "include",
      headers,
    });
    const payload = (await response.json()) as ContributionLookupsPayload & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load contribution lookups.");
    }
    lookupCacheByAuth.set(key, {
      expiresAt: Date.now() + LOOKUPS_TTL_MS,
      value: payload,
    });
    return payload;
  })();

  lookupInflightByAuth.set(key, request);
  try {
    return await request;
  } finally {
    lookupInflightByAuth.delete(key);
  }
}

export async function getContributionMemberOptionsCached() {
  const headers = await getAuthHeaders();
  const key = authCacheKey(headers);
  const cached = memberOptionsCacheByAuth.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflight = memberOptionsInflightByAuth.get(key);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const response = await fetch("/api/contributions/member-options", {
      credentials: "include",
      headers,
    });
    const payload = (await response.json()) as ContributionMemberOptionsPayload & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load contribution members.");
    }
    memberOptionsCacheByAuth.set(key, {
      expiresAt: Date.now() + MEMBER_OPTIONS_TTL_MS,
      value: payload,
    });
    return payload;
  })();

  memberOptionsInflightByAuth.set(key, request);
  try {
    return await request;
  } finally {
    memberOptionsInflightByAuth.delete(key);
  }
}
