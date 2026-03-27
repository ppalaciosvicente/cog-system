import { NextRequest, NextResponse } from "next/server";
import {
  type ContributionRecord,
  getContributionAccess,
  getContributionDonorStatusIds,
  isEligibleContributionDonor,
} from "@/lib/contributions";
import { buildHouseholdOptions } from "@/lib/households";
import { createServiceRoleClient } from "@/lib/supabase/service";

type MemberScopeRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  countrycode: string | null;
  statecode: string | null;
  householdid: number | null;
  spouseid: number | null;
};

type MemberDetailRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  address: string | null;
  address2: string | null;
  city: string | null;
  statecode: string | null;
  zip: string | null;
  countrycode: string | null;
  homephone: string | null;
  cellphone: string | null;
  email: string | null;
  baptized: boolean | null;
  baptizeddate: string | null;
  statusid: number | null;
  tithestatusid: number | null;
  householdid: number | null;
  spouseid: number | null;
  datecreated: string;
  dateupdated: string | null;
  emcstatus?: { name?: string | null } | { name?: string | null }[] | null;
  emctithestatus?: { name?: string | null } | { name?: string | null }[] | null;
  emccountry?: { name?: string | null } | { name?: string | null }[] | null;
};

type LookupRow = {
  id: number;
  name: string | null;
  taxdeductable?: boolean | null;
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

type LookupCacheEntry = {
  expiresAt: number;
  fundTypeNameById: Map<number, string>;
  contributionTypeNameById: Map<number, string>;
  contributionTypeTaxById: Map<number, boolean>;
};

const LOOKUP_CACHE_TTL_MS = 60_000;
let lookupCache: LookupCacheEntry | null = null;

function displayName(member: { id: number; fname: string | null; lname: string | null }) {
  const last = String(member.lname ?? "").trim();
  const first = String(member.fname ?? "").trim();
  if (!last && !first) return `#${member.id}`;
  if (!last) return first;
  if (!first) return last;
  return `${last}, ${first}`;
}

function relationName(
  value: { name?: string | null } | { name?: string | null }[] | null | undefined,
) {
  const entry = Array.isArray(value) ? (value[0] ?? null) : value;
  return String(entry?.name ?? "").trim();
}

export async function GET(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const memberId = Number(request.nextUrl.searchParams.get("memberId"));
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return NextResponse.json({ error: "Missing donor/member id." }, { status: 400 });
  }
  const startDate = String(request.nextUrl.searchParams.get("startDate") ?? "").trim();
  const endDate = String(request.nextUrl.searchParams.get("endDate") ?? "").trim();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if ((startDate && !dateRegex.test(startDate)) || (endDate && !dateRegex.test(endDate))) {
    return NextResponse.json({ error: "Invalid date filters." }, { status: 400 });
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
  const { data: selectedMemberData, error: selectedMemberErr } = await supabase
    .from("emcmember")
    .select("id,fname,lname,countrycode,statecode,householdid,spouseid,baptized,statusid")
    .eq("id", memberId)
    .single();

  if (selectedMemberErr || !selectedMemberData) {
    return NextResponse.json({ error: "Donor not found." }, { status: 404 });
  }

  const selectedMember = selectedMemberData as MemberScopeRow & {
    baptized: boolean | null;
    statusid: number | null;
  };

  if (!isEligibleContributionDonor(selectedMember, donorStatusIds)) {
    return NextResponse.json({ error: "Donor not found." }, { status: 404 });
  }

  if (!access.isAdmin) {
    const countryCode = String(selectedMember.countrycode ?? "")
      .trim()
      .toUpperCase();
    if (!countryCode || !access.allowedCountryCodes.includes(countryCode)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let householdMembersQuery = supabase
    .from("emcmember")
    .select(
      "id,fname,lname,address,address2,city,statecode,zip,countrycode,homephone,cellphone,email,baptized,baptizeddate,statusid,tithestatusid,householdid,spouseid,datecreated,dateupdated,emcstatus(name),emctithestatus(name),emccountry(name)",
    )
    .in("statusid", donorStatusIds)
    .order("lname", { ascending: true })
    .order("fname", { ascending: true });

  if (selectedMember.householdid != null) {
    householdMembersQuery = householdMembersQuery.eq("householdid", selectedMember.householdid);
  } else {
    householdMembersQuery = householdMembersQuery.eq("id", selectedMember.id);
  }

  const { data: memberDetails, error: memberDetailErr } = await householdMembersQuery;
  if (memberDetailErr) {
    return NextResponse.json({ error: memberDetailErr.message }, { status: 500 });
  }

  const detailRows = (memberDetails ?? []) as MemberDetailRow[];
  if (!detailRows.length) {
    return NextResponse.json({ error: "Donor details not found." }, { status: 404 });
  }

  const households = buildHouseholdOptions(
    detailRows.map((row) => ({
      id: row.id,
      fname: row.fname,
      lname: row.lname,
      householdid: row.householdid,
      spouseid: row.spouseid,
    })),
  );
  const selectedHousehold =
    households.find((household) => household.memberIds.includes(selectedMember.id)) ?? null;
  if (!selectedHousehold) {
    return NextResponse.json({ error: "Donor not found." }, { status: 404 });
  }

  const representative =
    detailRows.find((row) => row.id === selectedHousehold.value) ?? detailRows[0];

  const { data: contributionRows, error: contributionErr } = await supabase
    .from("contribcontribution")
    .select(
      "id,memberid,amount,checkno,datedeposited,dateentered,comments,fundtypeid,contributiontypeid,currencycode",
    )
    .in("memberid", selectedHousehold.memberIds)
    .gte("datedeposited", startDate || "0001-01-01")
    .lte("datedeposited", endDate || "9999-12-31")
    .order("datedeposited", { ascending: false })
    .order("id", { ascending: false })
    .limit(2000);

  if (contributionErr) {
    return NextResponse.json({ error: contributionErr.message }, { status: 500 });
  }

  let fundTypeNameById: Map<number, string>;
  let contributionTypeNameById: Map<number, string>;
  let contributionTypeTaxById: Map<number, boolean>;
  if (lookupCache && lookupCache.expiresAt > Date.now()) {
    fundTypeNameById = lookupCache.fundTypeNameById;
    contributionTypeNameById = lookupCache.contributionTypeNameById;
    contributionTypeTaxById = lookupCache.contributionTypeTaxById;
  } else {
    const [
      { data: fundTypeRows, error: fundTypeErr },
      { data: contributionTypeRows, error: contributionTypeErr },
    ] = await Promise.all([
      supabase.from("contribfundtype").select("id,name").order("name", { ascending: true }),
      supabase.from("contribtype").select("id,name,taxdeductable").order("name", { ascending: true }),
    ]);
    if (fundTypeErr) {
      return NextResponse.json({ error: fundTypeErr.message }, { status: 500 });
    }
    if (contributionTypeErr) {
      return NextResponse.json({ error: contributionTypeErr.message }, { status: 500 });
    }

    fundTypeNameById = new Map<number, string>(
      ((fundTypeRows ?? []) as LookupRow[])
        .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
        .map((row) => [row.id, row.name]),
    );
    contributionTypeNameById = new Map<number, string>(
      ((contributionTypeRows ?? []) as LookupRow[])
        .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
        .map((row) => [row.id, row.name]),
    );
    contributionTypeTaxById = new Map<number, boolean>(
      ((contributionTypeRows ?? []) as LookupRow[])
        .filter((row): row is LookupRow & { id: number } => Number.isInteger(row.id))
        .map((row) => [row.id, Boolean(row.taxdeductable)]),
    );
    lookupCache = {
      expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
      fundTypeNameById,
      contributionTypeNameById,
      contributionTypeTaxById,
    };
  }

  const memberById = new Map<number, MemberDetailRow>(detailRows.map((row) => [row.id, row]));
  const householdLabelByMemberId = new Map<number, string>();
  selectedHousehold.memberIds.forEach((id) => householdLabelByMemberId.set(id, selectedHousehold.label));

  const contributions: ContributionRecord[] = ((contributionRows ?? []) as ContributionBaseRow[])
    .map((row) => {
      const member = memberById.get(row.memberid);
      if (!member) return null;

      return {
        id: row.id,
        memberId: row.memberid,
        memberName:
          householdLabelByMemberId.get(row.memberid) ??
          displayName({ id: member.id, fname: member.fname, lname: member.lname }),
        memberCountryCode: member.countrycode,
        amount: Number(row.amount),
        fundType: fundTypeNameById.get(row.fundtypeid) ?? String(row.fundtypeid),
        currencyCode: String(row.currencycode ?? "").trim().toUpperCase() || "USD",
        checkNo: row.checkno,
        contributionType:
          contributionTypeNameById.get(row.contributiontypeid) ?? String(row.contributiontypeid),
        taxDeductible: contributionTypeTaxById.get(row.contributiontypeid) ?? null,
        dateDeposited: row.datedeposited,
        dateEntered: row.dateentered,
        comments: row.comments,
      } satisfies ContributionRecord;
    })
    .filter((row): row is ContributionRecord => row !== null);

  return NextResponse.json({
    donorLabel: selectedHousehold.label,
    representative: {
      ...representative,
      statusName: relationName(representative.emcstatus),
      titheStatusName: relationName(representative.emctithestatus),
      countryName: relationName(representative.emccountry),
    },
    householdMembers: detailRows.map((row) => ({
      id: row.id,
      name: displayName({ id: row.id, fname: row.fname, lname: row.lname }),
      email: row.email,
      cellphone: row.cellphone,
      homephone: row.homephone,
    })),
    contributions,
  });
}
