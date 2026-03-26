import { NextRequest, NextResponse } from "next/server";
import {
  type ContributionRecord,
  type ContributionDraftInput,
  getContributionAccess,
  getContributionDonorStatusIds,
  isEligibleContributionDonor,
} from "@/lib/contributions";
import { buildHouseholdOptions } from "@/lib/households";
import { createServiceRoleClient } from "@/lib/supabase/service";

type Payload = {
  rows?: ContributionDraftInput[];
};

type MemberScopeRow = {
  id: number;
  countrycode: string | null;
  baptized: boolean | null;
  statusid: number | null;
  fname: string | null;
  lname: string | null;
  householdid: number | null;
  spouseid: number | null;
};

type LookupRow = {
  id: number;
  name: string | null;
};

type CurrencyRow = {
  code: string | null;
};

type CountryCurrencyRow = {
  countrycode: string | null;
  currencycode: string | null;
};

type ContributionBaseRow = {
  id: number;
  memberid: number;
  amount: number | string;
  checkno: string | null;
  datedeposited: string;
  dateentered: string;
  comments: string | null;
  fundtypeid: number;
  contributiontypeid: number;
  currencycode: string | null;
};

type ContributionAccessOk = Extract<Awaited<ReturnType<typeof getContributionAccess>>, { ok: true }>;

type ScopedMemberCacheEntry = {
  expiresAt: number;
  scopedMembers: MemberScopeRow[];
  householdByRepresentativeId: Map<number, { value: number; label: string; memberIds: number[] }>;
  householdLabelByMemberId: Map<number, string>;
};

type LookupCacheEntry = {
  expiresAt: number;
  fundTypeIdByName: Map<string, number>;
  contributionTypeIdByName: Map<string, number>;
  fundTypeNameById: Map<number, string>;
  contributionTypeNameById: Map<number, string>;
};

const SCOPED_MEMBER_CACHE_TTL_MS = 30_000;
const LOOKUP_CACHE_TTL_MS = 60_000;
const scopedMemberCache = new Map<string, ScopedMemberCacheEntry>();
let lookupCache: LookupCacheEntry | null = null;

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeCountryCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isValidDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function scopedMemberCacheKey(access: ContributionAccessOk) {
  return JSON.stringify({
    accountId: access.accountId,
    isAdmin: access.isAdmin,
    countries: access.allowedCountryCodes,
  });
}

async function getScopedMembersCached(
  supabase: ReturnType<typeof createServiceRoleClient>,
  access: ContributionAccessOk,
) {
  const key = scopedMemberCacheKey(access);
  const cached = scopedMemberCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const donorStatusIds = await getContributionDonorStatusIds(supabase);
  let memberQuery = supabase
    .from("emcmember")
    .select("id,fname,lname,countrycode,householdid,spouseid")
    .in("statusid", donorStatusIds);

  if (!access.isAdmin) {
    memberQuery = memberQuery.in("countrycode", access.allowedCountryCodes);
  }
  const { data: memberRows, error: memberErr } = await memberQuery.limit(2000);
  if (memberErr) {
    throw new Error(memberErr.message);
  }

  const scopedMembers = (memberRows ?? []) as MemberScopeRow[];
  const households = buildHouseholdOptions(scopedMembers);
  const householdByRepresentativeId = new Map(
    households.map((household) => [household.value, household]),
  );
  const householdLabelByMemberId = new Map<number, string>();
  households.forEach((household) => {
    household.memberIds.forEach((id) => householdLabelByMemberId.set(id, household.label));
  });

  const entry: ScopedMemberCacheEntry = {
    expiresAt: Date.now() + SCOPED_MEMBER_CACHE_TTL_MS,
    scopedMembers,
    householdByRepresentativeId,
    householdLabelByMemberId,
  };
  scopedMemberCache.set(key, entry);
  return entry;
}

async function getLookupMapsCached(supabase: ReturnType<typeof createServiceRoleClient>) {
  if (lookupCache && lookupCache.expiresAt > Date.now()) {
    return lookupCache;
  }

  const [{ data: fundTypeRows, error: fundTypeErr }, { data: contributionTypeRows, error: contributionTypeErr }] =
    await Promise.all([
      supabase.from("contribfundtype").select("id,name").order("name", { ascending: true }),
      supabase.from("contribtype").select("id,name").order("name", { ascending: true }),
    ]);

  if (fundTypeErr) {
    throw new Error(fundTypeErr.message);
  }
  if (contributionTypeErr) {
    throw new Error(contributionTypeErr.message);
  }

  const fundTypeIdByName = new Map<string, number>(
    ((fundTypeRows ?? []) as LookupRow[])
      .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
      .map((row) => [normalizeName(row.name), row.id]),
  );
  const contributionTypeIdByName = new Map<string, number>(
    ((contributionTypeRows ?? []) as LookupRow[])
      .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
      .map((row) => [normalizeName(row.name), row.id]),
  );
  const fundTypeNameById = new Map<number, string>(
    ((fundTypeRows ?? []) as LookupRow[])
      .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
      .map((row) => [row.id, row.name]),
  );
  const contributionTypeNameById = new Map<number, string>(
    ((contributionTypeRows ?? []) as LookupRow[])
      .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
      .map((row) => [row.id, row.name]),
  );

  lookupCache = {
    expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
    fundTypeIdByName,
    contributionTypeIdByName,
    fundTypeNameById,
    contributionTypeNameById,
  };
  return lookupCache;
}

export async function GET(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const startDate = String(request.nextUrl.searchParams.get("startDate") ?? "").trim();
  const endDate = String(request.nextUrl.searchParams.get("endDate") ?? "").trim();
  const memberIdParam = String(request.nextUrl.searchParams.get("memberId") ?? "").trim();
  const fundTypeParam = String(request.nextUrl.searchParams.get("fundType") ?? "").trim();
  const contributionTypeParam = String(
    request.nextUrl.searchParams.get("contributionType") ?? "",
  ).trim();
  const countryParam = normalizeCountryCode(request.nextUrl.searchParams.get("country"));

  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
    return NextResponse.json(
      { error: "Start date and end date are required." },
      { status: 400 },
    );
  }

  const memberIdFilter = memberIdParam ? Number(memberIdParam) : null;
  if (memberIdParam && (!Number.isInteger(memberIdFilter) || Number(memberIdFilter) <= 0)) {
    return NextResponse.json({ error: "Invalid member filter." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  let scopedMembers: MemberScopeRow[] = [];
  let householdByRepresentativeId = new Map<number, { value: number; label: string; memberIds: number[] }>();
  let householdLabelByMemberId = new Map<number, string>();
  let fundTypeIdByName = new Map<string, number>();
  let contributionTypeIdByName = new Map<string, number>();
  let fundTypeNameById = new Map<number, string>();
  let contributionTypeNameById = new Map<number, string>();

  try {
    const scoped = await getScopedMembersCached(supabase, access);
    scopedMembers = scoped.scopedMembers;
    householdByRepresentativeId = scoped.householdByRepresentativeId;
    householdLabelByMemberId = scoped.householdLabelByMemberId;

    const lookups = await getLookupMapsCached(supabase);
    fundTypeIdByName = lookups.fundTypeIdByName;
    contributionTypeIdByName = lookups.contributionTypeIdByName;
    fundTypeNameById = lookups.fundTypeNameById;
    contributionTypeNameById = lookups.contributionTypeNameById;
  } catch (loadError) {
    return NextResponse.json(
      { error: loadError instanceof Error ? loadError.message : "Failed to load contributions." },
      { status: 500 },
    );
  }

  const scopedMemberIds = memberIdFilter
    ? (householdByRepresentativeId.get(memberIdFilter)?.memberIds ?? [])
    : scopedMembers.map((row) => row.id);
  const memberById = new Map<number, MemberScopeRow>(scopedMembers.map((row) => [row.id, row]));
  const scopedMemberIdsByCountry = countryParam
    ? scopedMemberIds.filter(
        (id) => normalizeCountryCode(memberById.get(id)?.countrycode) === countryParam,
      )
    : scopedMemberIds;

  if (!scopedMemberIdsByCountry.length) {
    return NextResponse.json({ rows: [] as ContributionRecord[] });
  }

  let contributionQuery = supabase
    .from("contribcontribution")
    .select(
      "id,memberid,amount,checkno,datedeposited,dateentered,comments,fundtypeid,contributiontypeid,currencycode",
    )
    .in("memberid", scopedMemberIdsByCountry)
    .gte("datedeposited", startDate)
    .lte("datedeposited", endDate)
    .order("datedeposited", { ascending: false })
    .order("id", { ascending: false })
    .limit(2000);

  if (fundTypeParam) {
    const fundTypeId = fundTypeIdByName.get(normalizeName(fundTypeParam));
    if (!fundTypeId) return NextResponse.json({ rows: [] as ContributionRecord[] });
    contributionQuery = contributionQuery.eq("fundtypeid", fundTypeId);
  }

  if (contributionTypeParam) {
    const contributionTypeId = contributionTypeIdByName.get(normalizeName(contributionTypeParam));
    if (!contributionTypeId) return NextResponse.json({ rows: [] as ContributionRecord[] });
    contributionQuery = contributionQuery.eq("contributiontypeid", contributionTypeId);
  }

  const { data: contributionRows, error: contributionErr } = await contributionQuery;
  if (contributionErr) {
    return NextResponse.json({ error: contributionErr.message }, { status: 500 });
  }

  const rows: ContributionRecord[] = ((contributionRows ?? []) as ContributionBaseRow[])
    .map((row) => {
      const member = memberById.get(row.memberid);
      if (!member) return null;
      return {
        id: row.id,
        memberId: row.memberid,
        memberName:
          householdLabelByMemberId.get(row.memberid) ??
          [member.lname, member.fname].filter(Boolean).join(", "),
        memberCountryCode: member.countrycode,
        amount: Number(row.amount),
        fundType: fundTypeNameById.get(row.fundtypeid) ?? String(row.fundtypeid),
        currencyCode: normalizeCountryCode(row.currencycode) || "USD",
        checkNo: row.checkno,
        contributionType:
          contributionTypeNameById.get(row.contributiontypeid) ?? String(row.contributiontypeid),
        dateDeposited: row.datedeposited,
        dateEntered: row.dateentered,
        comments: row.comments,
      };
    })
    .filter((row): row is ContributionRecord => Boolean(row));

  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!access.memberId) {
    return NextResponse.json(
      { error: "No member record is linked to this contribution account." },
      { status: 400 },
    );
  }

  const payload = ((await request.json().catch(() => ({} as Payload))) ?? {}) as Payload;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];

  if (!rows.length) {
    return NextResponse.json({ error: "At least one contribution row is required." }, { status: 400 });
  }

  for (const [index, row] of rows.entries()) {
    if (!Number.isInteger(row.memberId) || row.memberId <= 0) {
      return NextResponse.json(
        { error: `Row ${index + 1}: member is required.` },
        { status: 400 },
      );
    }
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
      return NextResponse.json(
        { error: `Row ${index + 1}: amount must be greater than zero.` },
        { status: 400 },
      );
    }
    if (!normalizeName(row.fundType)) {
      return NextResponse.json(
        { error: `Row ${index + 1}: fund type is required.` },
        { status: 400 },
      );
    }
    if (!normalizeName(row.contributionType)) {
      return NextResponse.json(
        { error: `Row ${index + 1}: contribution type is required.` },
        { status: 400 },
      );
    }
    if (!isValidDateOnly(String(row.dateDeposited ?? ""))) {
      return NextResponse.json(
        { error: `Row ${index + 1}: date deposited must be a valid date.` },
        { status: 400 },
      );
    }
    if (!isValidDateOnly(String(row.dateEntered ?? todayDateString()))) {
      return NextResponse.json(
        { error: `Row ${index + 1}: date entered must be a valid date.` },
        { status: 400 },
      );
    }
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
  const memberIds = Array.from(new Set(rows.map((row) => row.memberId)));
  const fundTypeValues = Array.from(new Set(rows.map((row) => row.fundType)));
  const contributionTypeValues = Array.from(new Set(rows.map((row) => row.contributionType)));
  const explicitCurrencyCodes = Array.from(
    new Set(
      rows
        .map((row) => normalizeCountryCode(row.currencyCode))
        .filter(Boolean),
    ),
  );

  const [
    { data: memberRows, error: memberErr },
    { data: fundTypeRows, error: fundTypeErr },
    { data: contributionTypeRows, error: contributionTypeErr },
    { data: currencyRows, error: currencyErr },
  ] = await Promise.all([
    supabase.from("emcmember").select("id,countrycode,baptized,statusid").in("id", memberIds),
    supabase.from("contribfundtype").select("id,name").in("name", fundTypeValues),
    supabase.from("contribtype").select("id,name").in("name", contributionTypeValues),
    supabase.from("contribcurrency").select("code").in("code", explicitCurrencyCodes.length ? explicitCurrencyCodes : ["USD"]),
  ]);

  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }
  if (fundTypeErr) {
    return NextResponse.json({ error: fundTypeErr.message }, { status: 500 });
  }
  if (contributionTypeErr) {
    return NextResponse.json({ error: contributionTypeErr.message }, { status: 500 });
  }
  if (currencyErr) {
    return NextResponse.json({ error: currencyErr.message }, { status: 500 });
  }

  const memberById = new Map<number, MemberScopeRow>(
    ((memberRows ?? []) as MemberScopeRow[]).map((row) => [row.id, row]),
  );
  const fundTypeIdByName = new Map<string, number>(
    ((fundTypeRows ?? []) as LookupRow[])
      .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
      .map((row) => [normalizeName(row.name), row.id]),
  );
  const contributionTypeIdByName = new Map<string, number>(
    ((contributionTypeRows ?? []) as LookupRow[])
      .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
      .map((row) => [normalizeName(row.name), row.id]),
  );
  const validCurrencyCodes = new Set(
    ((currencyRows ?? []) as CurrencyRow[])
      .map((row) => normalizeCountryCode(row.code))
      .filter(Boolean),
  );
  const memberCountries = Array.from(
    new Set(
      (memberRows ?? [])
        .map((row) => normalizeCountryCode((row as MemberScopeRow).countrycode))
        .filter(Boolean),
    ),
  );
  const { data: countryCurrencyRows, error: countryCurrencyErr } = await supabase
    .from("contribcountrycurrency")
    .select("countrycode,currencycode")
    .in("countrycode", memberCountries.length ? memberCountries : ["__none__"]);
  if (countryCurrencyErr) {
    return NextResponse.json({ error: countryCurrencyErr.message }, { status: 500 });
  }
  const currencyByCountry = new Map<string, string>(
    ((countryCurrencyRows ?? []) as CountryCurrencyRow[])
      .map((row) => [normalizeCountryCode(row.countrycode), normalizeCountryCode(row.currencycode)] as const)
      .filter(([countryCode, currencyCode]) => countryCode && currencyCode),
  );

  for (const [index, row] of rows.entries()) {
    const member = memberById.get(row.memberId);
    if (!member) {
      return NextResponse.json(
        { error: `Row ${index + 1}: selected member was not found.` },
        { status: 400 },
      );
    }

    if (!isEligibleContributionDonor(member, donorStatusIds)) {
      return NextResponse.json(
        {
          error: `Row ${index + 1}: selected member is not an eligible donor.`,
        },
        { status: 400 },
      );
    }

    if (!access.isAdmin) {
      const memberCountry = normalizeCountryCode(member.countrycode);
      if (!memberCountry || !access.allowedCountryCodes.includes(memberCountry)) {
        return NextResponse.json(
          { error: `Row ${index + 1}: selected member is outside your contribution region.` },
          { status: 403 },
        );
      }
    }

    if (!fundTypeIdByName.has(normalizeName(row.fundType))) {
      return NextResponse.json(
        { error: `Row ${index + 1}: fund type "${row.fundType}" was not found.` },
        { status: 400 },
      );
    }

    if (!contributionTypeIdByName.has(normalizeName(row.contributionType))) {
      return NextResponse.json(
        { error: `Row ${index + 1}: contribution type "${row.contributionType}" was not found.` },
        { status: 400 },
      );
    }

    const explicitCurrency = normalizeCountryCode(row.currencyCode);
    if (explicitCurrency && !validCurrencyCodes.has(explicitCurrency)) {
      return NextResponse.json(
        { error: `Row ${index + 1}: currency "${row.currencyCode}" was not found.` },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();
  const insertRows = rows.map((row) => ({
    memberid: row.memberId,
    datedeposited: row.dateDeposited,
    dateentered: row.dateEntered ?? todayDateString(),
    amount: Number(row.amount.toFixed(2)),
    comments: cleanText(row.comments),
    checkno: cleanText(row.checkNo),
    contributorid: access.memberId,
    fundtypeid: fundTypeIdByName.get(normalizeName(row.fundType)),
    contributiontypeid: contributionTypeIdByName.get(normalizeName(row.contributionType)),
    currencycode:
      normalizeCountryCode(row.currencyCode) ||
      currencyByCountry.get(normalizeCountryCode(memberById.get(row.memberId)?.countrycode)) ||
      "USD",
    datecreated: now,
    dateupdated: now,
  }));

  const { error } = await supabase.from("contribcontribution").insert(insertRows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: insertRows.length });
}
