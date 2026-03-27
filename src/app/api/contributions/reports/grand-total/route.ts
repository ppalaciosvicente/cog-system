import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { getContributionAccess } from "@/lib/contributions";
import { getContributionScopeSummary } from "@/lib/contribution-scope";
import { getCountryNamesForCodes } from "@/lib/report-country-cache";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

type MemberRow = {
  id: number;
};

type ContributionAmountRow = {
  amount: number | string;
  currencycode: string | null;
  fundtypeid?: number;
  contributiontypeid?: number;
};

function isValidDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function formatCurrency(amount: number, currencyCode: string) {
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

function formatShortDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function buildGrandTotalPdf({
  startDate,
  endDate,
  scopeLabel,
  filtersLabel,
  totalsByCurrency,
  contributionCount,
  generatedFooter,
}: {
  startDate: string;
  endDate: string;
  scopeLabel: string;
  filtersLabel: string;
  totalsByCurrency: Array<{ currencyCode: string; totalAmount: number; count: number }>;
  contributionCount: number;
  generatedFooter: string;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 0,
      compress: true,
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Times-BoldItalic").fontSize(20).text("Grand Total", 0, 79, {
      width: doc.page.width,
      align: "center",
    });

    doc.font("Helvetica").fontSize(12).text(
      `From ${formatShortDateLabel(startDate)} through ${formatShortDateLabel(endDate)}`,
      0,
      105,
      {
        width: doc.page.width,
        align: "center",
      },
    );

    doc.font("Helvetica").fontSize(11).text(`Scope: ${scopeLabel}`, 0, 123, {
      width: doc.page.width,
      align: "center",
    });
    if (filtersLabel.trim()) {
      const lines = filtersLabel.split("\n");
      lines.forEach((line, idx) => {
        doc.font("Helvetica").fontSize(10).text(line, 0, 138 + idx * 12, {
          width: doc.page.width,
          align: "center",
        });
      });
    }

    let totalsY = filtersLabel.trim() ? 170 + (filtersLabel.split("\n").length - 1) * 12 : 156;
    doc.font("Helvetica-Bold").fontSize(11);
    if (totalsByCurrency.length <= 1) {
      const row = totalsByCurrency[0] ?? { currencyCode: "USD", totalAmount: 0, count: 0 };
      doc.text(`Grand Total: ${formatCurrency(row.totalAmount, row.currencyCode)}`, 105, totalsY);
      totalsY += 18;
    } else {
      doc.text("Grand Totals by Currency:", 105, totalsY);
      totalsY += 16;
      totalsByCurrency.forEach((row) => {
        doc
          .font("Helvetica")
          .fontSize(11)
          .text(
            `${row.currencyCode}: ${formatCurrency(row.totalAmount, row.currencyCode)} (${row.count} contributions)`,
            120,
            totalsY,
          );
        totalsY += 15;
      });
    }

    doc.font("Helvetica").fontSize(10).text(
      `Contributions Counted: ${contributionCount}`,
      105,
      totalsY + 2,
    );

    doc.font("Times-BoldItalic").fontSize(9).text(generatedFooter, 76, 706, {
      lineBreak: false,
    });
    doc.font("Times-BoldItalic").fontSize(9).text("Page 1 of 1", 0, 706, {
      width: 536,
      align: "right",
      lineBreak: false,
    });

    doc.end();
  });
}

export async function GET(request: NextRequest) {
  try {
    const access = await getContributionAccess(request);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const startDate = String(request.nextUrl.searchParams.get("startDate") ?? "").trim();
    const endDate = String(request.nextUrl.searchParams.get("endDate") ?? "").trim();
    if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
      return NextResponse.json(
        { error: "Start date deposited and end date deposited are required." },
        { status: 400 },
      );
    }
    if (startDate > endDate) {
      return NextResponse.json(
        { error: "Start date deposited cannot be later than end date deposited." },
        { status: 400 },
      );
    }

    const supabase = createServiceRoleClient();
    const fundTypeParam = normalizeName(String(request.nextUrl.searchParams.get("fundType") ?? ""));
    const contributionTypeParam = normalizeName(
      String(request.nextUrl.searchParams.get("contributionType") ?? ""),
    );
    const requestedCountryCodes = Array.from(
      new Set(
        request.nextUrl.searchParams
          .getAll("country")
          .map((value) => normalizeCode(value))
          .filter(Boolean),
      ),
    );
    const [{ data: fundTypeRows, error: fundTypeErr }, { data: contributionTypeRows, error: contributionTypeErr }] =
      await Promise.all([
        supabase.from("contribfundtype").select("id,name").order("name", { ascending: true }),
        supabase.from("contribtype").select("id,name").order("name", { ascending: true }),
      ]);
    if (fundTypeErr) {
      return NextResponse.json({ error: fundTypeErr.message }, { status: 500 });
    }
    if (contributionTypeErr) {
      return NextResponse.json({ error: contributionTypeErr.message }, { status: 500 });
    }
    const fundTypeIdByName = new Map<string, number>(
      ((fundTypeRows ?? []) as { id: number; name: string | null }[])
        .filter((row) => row.name)
        .map((row) => [normalizeName(row.name), row.id]),
    );
    const contributionTypeIdByName = new Map<string, number>(
      ((contributionTypeRows ?? []) as { id: number; name: string | null }[])
        .filter((row) => row.name)
        .map((row) => [normalizeName(row.name), row.id]),
    );
    const fundTypeFilterId = fundTypeParam ? fundTypeIdByName.get(fundTypeParam) : null;
    if (fundTypeParam && !fundTypeFilterId) {
      return NextResponse.json({ error: "Selected fund type was not found." }, { status: 400 });
    }
    const contributionTypeFilterId = contributionTypeParam
      ? contributionTypeIdByName.get(contributionTypeParam)
      : null;
    if (contributionTypeParam && !contributionTypeFilterId) {
      return NextResponse.json(
        { error: "Selected contribution type was not found." },
        { status: 400 },
      );
    }
    let activeCountryCodes: string[] | null = null;
    let scopedMemberIds: number[] | null = null;

    if (!access.isAdmin) {
      if (!access.allowedCountryCodes.length) {
        return NextResponse.json(
          { error: "No contribution regions are assigned to this account yet." },
          { status: 400 },
        );
      }

      if (requestedCountryCodes.length > 0) {
        const invalidCodes = requestedCountryCodes.filter(
          (code) => !access.allowedCountryCodes.includes(code),
        );
        if (invalidCodes.length > 0) {
          return NextResponse.json(
            { error: "One or more selected countries are outside your scope." },
            { status: 400 },
          );
        }
      }

      activeCountryCodes =
        requestedCountryCodes.length > 0 ? requestedCountryCodes : access.allowedCountryCodes;
      if (!activeCountryCodes.length) {
        return NextResponse.json(
          { error: "Select at least one country." },
          { status: 400 },
        );
      }

      const { data: memberRows, error: memberErr } = await supabase
        .from("emcmember")
        .select("id")
        .in("countrycode", activeCountryCodes)
        .limit(5000);

      if (memberErr) {
        return NextResponse.json({ error: memberErr.message }, { status: 500 });
      }

      scopedMemberIds = ((memberRows ?? []) as MemberRow[]).map((row) => row.id);
      if (!scopedMemberIds.length) {
        scopedMemberIds = [];
      }
    } else if (requestedCountryCodes.length > 0) {
      activeCountryCodes = requestedCountryCodes;
      const { data: memberRows, error: memberErr } = await supabase
        .from("emcmember")
        .select("id")
        .in("countrycode", activeCountryCodes)
        .limit(5000);

      if (memberErr) {
        return NextResponse.json({ error: memberErr.message }, { status: 500 });
      }

      scopedMemberIds = ((memberRows ?? []) as MemberRow[]).map((row) => row.id);
      if (!scopedMemberIds.length) {
        scopedMemberIds = [];
      }
    }

    const totalsByCurrency = new Map<string, { totalAmount: number; count: number }>();
    let contributionCount = 0;
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      let contributionQuery = supabase
        .from("contribcontribution")
        .select("amount,currencycode,fundtypeid,contributiontypeid")
        .gte("datedeposited", startDate)
        .lte("datedeposited", endDate)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (scopedMemberIds) {
        if (!scopedMemberIds.length) {
          break;
        }
        contributionQuery = contributionQuery.in("memberid", scopedMemberIds);
      }
      if (fundTypeFilterId) {
        contributionQuery = contributionQuery.eq("fundtypeid", fundTypeFilterId);
      }
      if (contributionTypeFilterId) {
        contributionQuery = contributionQuery.eq("contributiontypeid", contributionTypeFilterId);
      }

      const { data: contributionRows, error: contributionErr } = await contributionQuery;
      if (contributionErr) {
        return NextResponse.json({ error: contributionErr.message }, { status: 500 });
      }

      const rows = (contributionRows ?? []) as ContributionAmountRow[];
      for (const row of rows) {
        const currencyCode = normalizeCode(row.currencycode) || "USD";
        const existing = totalsByCurrency.get(currencyCode) ?? { totalAmount: 0, count: 0 };
        existing.totalAmount += Number(row.amount ?? 0);
        existing.count += 1;
        totalsByCurrency.set(currencyCode, existing);
        contributionCount += 1;
      }
      if (rows.length < PAGE_SIZE) {
        break;
      }
    }

    const scope =
      activeCountryCodes && activeCountryCodes.length > 0
        ? {
            countryNames: await getCountryNamesForCodes(supabase, activeCountryCodes),
            label: "",
          }
        : await getContributionScopeSummary(access);
    const scopeLabel =
      activeCountryCodes && activeCountryCodes.length > 0
        ? scope.countryNames.join(", ")
        : scope.label;
    const filtersLabelParts: string[] = [];
    if (fundTypeParam) filtersLabelParts.push(`Fund Type: ${fundTypeParam}`);
    if (contributionTypeParam) filtersLabelParts.push(`Contribution Type: ${contributionTypeParam}`);
    const filtersLabel = filtersLabelParts.join("\n");
    const generatedFooter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date());

    const pdf = await buildGrandTotalPdf({
      startDate,
      endDate,
      scopeLabel,
      filtersLabel,
      totalsByCurrency: [...totalsByCurrency.entries()]
        .map(([currencyCode, value]) => ({
          currencyCode,
          totalAmount: value.totalAmount,
          count: value.count,
        }))
        .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
      contributionCount,
      generatedFooter,
    });

    const filename = `grand-total-${startDate}-to-${endDate}.pdf`;
    return new Response(pdf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate Grand Total report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
