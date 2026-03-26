import { NextRequest, NextResponse } from "next/server";
import { getContributionAccess } from "@/lib/contributions";
import {
  formatCurrency,
  startOfNextUtcDay,
  startOfUtcDay,
  todayDateString,
} from "@/lib/contribution-daily-entry";
import { buildHouseholdOptions } from "@/lib/households";
import { createServiceRoleClient } from "@/lib/supabase/service";

type ContributionRow = {
  id: number;
  memberid: number;
  amount: number | string;
  fundtypeid: number;
  contributiontypeid: number;
  currencycode: string | null;
  checkno: string | null;
  datedeposited: string;
  dateentered: string;
  comments: string | null;
};

type MemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  householdid: number | null;
  spouseid: number | null;
};

function formatHouseholdLabel(label: string | undefined) {
  if (!label) return "";
  return label.replace(/\s*\(\+\d+\s+household members\)/i, "");
}

function displayName(member: Pick<MemberRow, "fname" | "lname">) {
  return [member.lname, member.fname].filter(Boolean).join(", ");
}

function formatHouseholdName(
  household: ReturnType<typeof buildHouseholdOptions<MemberRow>>[number] | undefined,
  memberById: Map<number, MemberRow>,
) {
  if (!household) return "";
  const members = household.memberIds.map((id) => memberById.get(id)).filter(Boolean) as MemberRow[];

  if (members.length === 2) {
    const [a, b] = members;
    const reciprocal = a.spouseid === b.id && b.spouseid === a.id;
    const sameLast =
      String(a.lname ?? "").trim().toUpperCase() === String(b.lname ?? "").trim().toUpperCase();
    if (reciprocal && sameLast) {
      const last = String(a.lname ?? "").trim();
      const firstA = String(a.fname ?? "").trim();
      const firstB = String(b.fname ?? "").trim();
      return [last, [firstA, firstB].filter(Boolean).join(" & ")].filter(Boolean).join(", ");
    }
  }

  return formatHouseholdLabel(household.label) || displayName(members[0] ?? { lname: "", fname: "" });
}

function isValidDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
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

  try {
    const supabase = createServiceRoleClient();
    const dateEnteredParam = String(request.nextUrl.searchParams.get("dateEntered") ?? "").trim();
    const dateEntered = isValidDateOnly(dateEnteredParam) ? dateEnteredParam : todayDateString();
    const { data: contributionRows, error: contributionErr } = await supabase
      .from("contribcontribution")
      .select(
        "id,memberid,amount,fundtypeid,contributiontypeid,currencycode,checkno,datedeposited,dateentered,comments",
      )
      .eq("contributorid", access.memberId)
      .gte("dateentered", startOfUtcDay(dateEntered))
      .lt("dateentered", startOfNextUtcDay(dateEntered))
      .order("id", { ascending: false });

    if (contributionErr) {
      throw new Error(contributionErr.message);
    }

    const rows = (contributionRows ?? []) as ContributionRow[];
    if (!rows.length) {
      return NextResponse.json({
        dateEntered,
        rows: [],
        totalsByCurrency: [],
        contributionCount: 0,
      });
    }

    const memberIds = Array.from(new Set(rows.map((row) => row.memberid)));
    const fundTypeIds = Array.from(new Set(rows.map((row) => row.fundtypeid)));
    const contributionTypeIds = Array.from(new Set(rows.map((row) => row.contributiontypeid)));

    const [
      { data: memberRows, error: memberErr },
      { data: fundTypeRows, error: fundTypeErr },
      { data: contributionTypeRows, error: contributionTypeErr },
    ] = await Promise.all([
      supabase
        .from("emcmember")
        .select("id,fname,lname,householdid,spouseid,statusid")
        .in("id", memberIds),
      supabase.from("contribfundtype").select("id,name").in("id", fundTypeIds),
      supabase.from("contribtype").select("id,name").in("id", contributionTypeIds),
    ]);

    if (memberErr) throw new Error(memberErr.message);
    if (fundTypeErr) throw new Error(fundTypeErr.message);
    if (contributionTypeErr) throw new Error(contributionTypeErr.message);

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
          .select("id,fname,lname,householdid,spouseid,statusid")
          .in("id", extraIds)
          .order("lname", { ascending: true })
          .order("fname", { ascending: true });
        if (spouseErr) throw new Error(spouseErr.message);
        members = spouseRows ? [...members, ...(spouseRows as MemberRow[])] : members;
      }
    }

    const households = buildHouseholdOptions(members);
    const householdByMemberId = new Map<number, (typeof households)[number]>();
    households.forEach((household) => {
      household.memberIds.forEach((memberId) => householdByMemberId.set(memberId, household));
    });
    const fundTypeNameById = new Map(
      ((fundTypeRows ?? []) as LookupRow[]).map((row) => [row.id, row.name ?? String(row.id)]),
    );
    const contributionTypeNameById = new Map(
      ((contributionTypeRows ?? []) as LookupRow[]).map((row) => [row.id, row.name ?? String(row.id)]),
    );
    const totalsByCurrency = new Map<string, number>();

    const responseRows = rows.map((row) => {
      const currencyCode = String(row.currencycode ?? "").trim().toUpperCase() || "USD";
      totalsByCurrency.set(currencyCode, (totalsByCurrency.get(currencyCode) ?? 0) + Number(row.amount));
      const household = householdByMemberId.get(row.memberid);
      return {
        id: row.id,
        memberId: row.memberid,
        donorLabel:
          household?.label?.replace(/\s*\(\+\d+\s+household members\)/i, "") || `#${row.memberid}`,
        amount: Number(row.amount),
        formattedAmount: formatCurrency(Number(row.amount), currencyCode),
        fundType: fundTypeNameById.get(row.fundtypeid) ?? String(row.fundtypeid),
        contributionType:
          contributionTypeNameById.get(row.contributiontypeid) ?? String(row.contributiontypeid),
        currencyCode,
        checkNo: row.checkno ?? "",
        dateDeposited: row.datedeposited,
        dateEntered: row.dateentered,
        comments: row.comments ?? "",
      };
    });

    return NextResponse.json({
      dateEntered,
      rows: responseRows,
      totalsByCurrency: [...totalsByCurrency.entries()].map(([currencyCode, totalAmount]) => ({
        currencyCode,
        totalAmount,
        formattedAmount: formatCurrency(totalAmount, currencyCode),
      })),
      contributionCount: rows.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load daily entries." },
      { status: 500 },
    );
  }
}
