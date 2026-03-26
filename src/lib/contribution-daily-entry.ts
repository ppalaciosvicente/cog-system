import { buildHouseholdOptions } from "@/lib/households";
import { createServiceRoleClient } from "@/lib/supabase/service";

type ContributionBaseRow = {
  memberid: number;
  amount: number | string;
  currencycode: string | null;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  householdid: number | null;
  spouseid: number | null;
  city: string | null;
  statecode: string | null;
  zip: string | null;
  countrycode: string | null;
};

export type DailyEntrySummaryRow = {
  donorLabel: string;
  totalAmount: number;
  currencyCode: string;
  locationLabel: string;
};

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function startOfUtcDay(value: string) {
  return `${value}T00:00:00.000Z`;
}

export function startOfNextUtcDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export function formatShortDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function formatCurrency(amount: number, currencyCode: string) {
  const code = normalizeCode(currencyCode) || "USD";
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    if (code === "EUR") {
      return formatted.replace(/^€\s?/, "€ ");
    }
    return formatted;
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function formatLocation(member: MemberRow | undefined) {
  if (!member) return "";

  const city = String(member.city ?? "").trim();
  const state = normalizeCode(member.statecode);
  const zip = String(member.zip ?? "").trim();
  const country = normalizeCode(member.countrycode);

  const cityState = [city, state].filter(Boolean).join(", ");
  if (cityState && zip) return `${cityState} ${zip}`;
  if (cityState) return cityState;
  if (zip) return zip;
  return country;
}

function formatHouseholdLabel(label: string | undefined) {
  if (!label) return "";
  return label.replace(/\s*\(\+\d+\s+household members\)/i, "");
}

export async function getDailyEntrySummary(
  supabase: ReturnType<typeof createServiceRoleClient>,
  contributorId: number,
  dateEntered = todayDateString(),
) {
  const { data: contributionRows, error: contributionErr } = await supabase
    .from("contribcontribution")
    .select("memberid,amount,currencycode")
    .eq("contributorid", contributorId)
    .gte("dateentered", startOfUtcDay(dateEntered))
    .lt("dateentered", startOfNextUtcDay(dateEntered))
    .order("id", { ascending: true });

  if (contributionErr) {
    throw new Error(contributionErr.message);
  }

  const baseRows = (contributionRows ?? []) as ContributionBaseRow[];
  if (!baseRows.length) {
    return {
      dateEntered,
      rows: [] as DailyEntrySummaryRow[],
      totalsByCurrency: [] as Array<{ currencyCode: string; totalAmount: number }>,
      contributionCount: 0,
    };
  }

  const memberIds = Array.from(new Set(baseRows.map((row) => row.memberid)));
  const { data: memberRows, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,fname,lname,householdid,spouseid,city,statecode,zip,countrycode,statusid")
    .in("id", memberIds);

  if (memberErr) {
    throw new Error(memberErr.message);
  }

  const baseMembers = (memberRows ?? []) as MemberRow[];
  const spouseIds = Array.from(
    new Set(baseMembers.map((row) => row.spouseid).filter((id): id is number => id != null)),
  );

  let members = baseMembers;
  if (spouseIds.length > 0) {
    const extraIds = spouseIds.filter((id) => !members.some((member) => member.id === id));
    if (extraIds.length > 0) {
      const { data: spouseRows, error: spouseErr } = await supabase
        .from("emcmember")
        .select("id,fname,lname,householdid,spouseid,city,statecode,zip,countrycode,statusid")
        .in("id", extraIds)
        .order("lname", { ascending: true })
        .order("fname", { ascending: true });
      if (spouseErr) {
        throw new Error(spouseErr.message);
      }
      members = spouseRows ? [...members, ...(spouseRows as MemberRow[])] : members;
    }
  }
  const households = buildHouseholdOptions(members);
  const householdByMemberId = new Map<number, (typeof households)[number]>();
  households.forEach((household) => {
    household.memberIds.forEach((memberId) => householdByMemberId.set(memberId, household));
  });

  const summaryByKey = new Map<string, DailyEntrySummaryRow>();
  const totalsByCurrency = new Map<string, number>();

  baseRows.forEach((row) => {
    const household = householdByMemberId.get(row.memberid);
    const donorLabel = formatHouseholdLabel(household?.label) || `#${row.memberid}`;
    const representative = household
      ? members.find((member) => member.id === household.value)
      : members.find((member) => member.id === row.memberid);
    const locationLabel = formatLocation(representative);
    const currencyCode = normalizeCode(row.currencycode) || "USD";
    const key = `${donorLabel}__${locationLabel}__${currencyCode}`;
    const amount = Number(row.amount);
    const existing = summaryByKey.get(key);

    if (existing) {
      existing.totalAmount += amount;
    } else {
      summaryByKey.set(key, {
        donorLabel,
        totalAmount: amount,
        currencyCode,
        locationLabel,
      });
    }

    totalsByCurrency.set(currencyCode, (totalsByCurrency.get(currencyCode) ?? 0) + amount);
  });

  return {
    dateEntered,
    rows: [...summaryByKey.values()].sort((a, b) => a.donorLabel.localeCompare(b.donorLabel)),
    totalsByCurrency: [...totalsByCurrency.entries()]
      .map(([currencyCode, totalAmount]) => ({ currencyCode, totalAmount }))
      .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
    contributionCount: baseRows.length,
  };
}
