import { NextRequest, NextResponse } from "next/server";
import {
  type ContributionDraftInput,
  getContributionAccess,
  getContributionDonorStatusIds,
  isEligibleContributionDonor,
} from "@/lib/contributions";
import { createServiceRoleClient } from "@/lib/supabase/service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
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

type ExistingContributionRow = {
  id: number;
  memberid: number;
};

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

function cleanText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

async function resolveContributionId(context: RouteContext) {
  const params = await context.params;
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function requireScopedExistingContribution(
  contributionId: number,
  access: Extract<Awaited<ReturnType<typeof getContributionAccess>>, { ok: true }>,
) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("contribcontribution")
    .select("id,memberid")
    .eq("id", contributionId)
    .single();

  if (error || !data) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Contribution not found." }, { status: 404 }),
    };
  }

  const row = data as ExistingContributionRow;
  if (access.isAdmin) {
    return { ok: true as const, contribution: row, supabase };
  }

  const { data: member, error: memberErr } = await supabase
    .from("emcmember")
    .select("id,countrycode")
    .eq("id", row.memberid)
    .single();

  if (memberErr || !member) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Contribution member not found." }, { status: 400 }),
    };
  }

  const memberCountry = normalizeCountryCode(member.countrycode);
  if (!memberCountry || !access.allowedCountryCodes.includes(memberCountry)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, contribution: row, supabase };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const access = await getContributionAccess(request);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const contributionId = await resolveContributionId(context);
    if (!contributionId) {
      return NextResponse.json({ error: "Invalid contribution id." }, { status: 400 });
    }

    const payload = ((await request.json().catch(() => ({} as ContributionDraftInput))) ??
      {}) as ContributionDraftInput;

    if (!Number.isInteger(payload.memberId) || payload.memberId <= 0) {
      return NextResponse.json({ error: "Member is required." }, { status: 400 });
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return NextResponse.json({ error: "Amount must be greater than zero." }, { status: 400 });
    }
    if (!normalizeName(payload.fundType)) {
      return NextResponse.json({ error: "Fund type is required." }, { status: 400 });
    }
    if (!normalizeName(payload.contributionType)) {
      return NextResponse.json({ error: "Contribution type is required." }, { status: 400 });
    }
    if (!isValidDateOnly(String(payload.dateDeposited ?? ""))) {
      return NextResponse.json({ error: "Date deposited must be valid." }, { status: 400 });
    }

    const existing = await requireScopedExistingContribution(contributionId, access);
    if (!existing.ok) return existing.response;

    const { supabase } = existing;
    let donorStatusIds: number[] = [];
    try {
      donorStatusIds = await getContributionDonorStatusIds(supabase);
    } catch (loadError) {
      return NextResponse.json(
        { error: loadError instanceof Error ? loadError.message : "Failed to load statuses." },
        { status: 500 },
      );
    }
    const [
      { data: member, error: memberErr },
      { data: fundTypeRows, error: fundTypeErr },
      { data: contributionTypeRows, error: contributionTypeErr },
      { data: currencyRows, error: currencyErr },
    ] = await Promise.all([
      supabase
        .from("emcmember")
        .select("id,countrycode,baptized,statusid")
        .eq("id", payload.memberId)
        .single(),
      supabase.from("contribfundtype").select("id,name").eq("name", payload.fundType),
      supabase.from("contribtype").select("id,name").eq("name", payload.contributionType),
      supabase.from("contribcurrency").select("code"),
    ]);

    if (memberErr || !member) {
      return NextResponse.json({ error: "Selected member was not found." }, { status: 400 });
    }
    if (!isEligibleContributionDonor(member, donorStatusIds)) {
      return NextResponse.json(
        { error: "Selected member is not an eligible donor." },
        { status: 400 },
      );
    }
    if (!access.isAdmin) {
      const memberCountry = normalizeCountryCode(member.countrycode);
      if (!memberCountry || !access.allowedCountryCodes.includes(memberCountry)) {
        return NextResponse.json(
          { error: "Selected member is outside your contribution region." },
          { status: 403 },
        );
      }
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

    const fundType = ((fundTypeRows ?? []) as LookupRow[]).find(
      (row) => normalizeName(row.name) === normalizeName(payload.fundType),
    );
    const contributionType = ((contributionTypeRows ?? []) as LookupRow[]).find(
      (row) => normalizeName(row.name) === normalizeName(payload.contributionType),
    );

    if (!fundType) {
      return NextResponse.json({ error: "Fund type was not found." }, { status: 400 });
    }
    if (!contributionType) {
      return NextResponse.json({ error: "Contribution type was not found." }, { status: 400 });
    }
    const validCurrencyCodes = new Set(
      ((currencyRows ?? []) as CurrencyRow[])
        .map((row) => normalizeCountryCode(row.code))
        .filter(Boolean),
    );
    const explicitCurrencyCode = normalizeCountryCode(payload.currencyCode);
    if (explicitCurrencyCode && !validCurrencyCodes.has(explicitCurrencyCode)) {
      return NextResponse.json({ error: "Currency was not found." }, { status: 400 });
    }

    let currencyCode = explicitCurrencyCode;
    if (!currencyCode) {
      const memberCountryCode = normalizeCountryCode(member.countrycode);
      if (memberCountryCode) {
        const { data: countryCurrencyRows, error: countryCurrencyErr } = await supabase
          .from("contribcountrycurrency")
          .select("countrycode,currencycode")
          .eq("countrycode", memberCountryCode)
          .limit(1);
        if (countryCurrencyErr) {
          return NextResponse.json({ error: countryCurrencyErr.message }, { status: 500 });
        }
        currencyCode =
          ((countryCurrencyRows ?? []) as CountryCurrencyRow[])
            .map((row) => normalizeCountryCode(row.currencycode))
            .find(Boolean) ?? "";
      }
    }

    const { error } = await supabase
      .from("contribcontribution")
      .update({
        memberid: payload.memberId,
        datedeposited: payload.dateDeposited,
        amount: Number(payload.amount.toFixed(2)),
        comments: cleanText(payload.comments),
        checkno: cleanText(payload.checkNo),
        fundtypeid: fundType.id,
        contributiontypeid: contributionType.id,
        currencycode: currencyCode || "USD",
        dateupdated: new Date().toISOString(),
      })
      .eq("id", contributionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update contribution.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const contributionId = await resolveContributionId(context);
  if (!contributionId) {
    return NextResponse.json({ error: "Invalid contribution id." }, { status: 400 });
  }

  const existing = await requireScopedExistingContribution(contributionId, access);
  if (!existing.ok) return existing.response;

  const { error } = await existing.supabase
    .from("contribcontribution")
    .delete()
    .eq("id", contributionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
