import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { getContributionAccess } from "@/lib/contributions";
import { getContributionScopeSummary } from "@/lib/contribution-scope";
import { buildHouseholdOptions } from "@/lib/households";
import { getCountryNamesForCodes } from "@/lib/report-country-cache";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;
const ROW_START_Y = 152;
const ROW_HEIGHT = 22;
const ROW_END_Y = 700;
const AMOUNT_COL_WIDTH = 58;
const PAGE_LEFT_X = 30;
const PAGE_RIGHT_X = 572;
const COLUMN_GAP = 8;
const MIN_FUND_COL_WIDTH = 32;

type ScopedMemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  householdid: number | null;
  spouseid: number | null;
  countrycode: string | null;
};

type ContributionBaseRow = {
  memberid: number;
  amount: number | string;
  fundtypeid: number;
  currencycode: string | null;
  contributiontypeid: number;
};

type LookupRow = {
  id: number;
  name: string | null;
};

type DonorTotalRow = {
  label: string;
  totalAmount: number;
  fundTypeTotals: Map<number, number>;
};

type FundTypeColumn = {
  id: number;
  name: string;
};

type ReportLayout = {
  nameX: number;
  nameWidth: number;
  totalX: number;
  totalWidth: number;
  fundColumns: Array<{ id: number; name: string; x: number; width: number }>;
};

function isValidDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
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

function getHeaderLabel(value: string, width: number) {
  const title = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
  const maxChars = Math.max(7, Math.floor(width / 5.4));
  if (title.length <= maxChars) {
    return title;
  }
  return `${title.slice(0, Math.max(4, maxChars - 3))}...`;
}

function buildReportLayout(fundTypeColumns: FundTypeColumn[]): ReportLayout {
  const totalWidth = AMOUNT_COL_WIDTH;
  const fundCount = Math.max(1, fundTypeColumns.length);
  let nameWidth = 220;
  let fundWidth = MIN_FUND_COL_WIDTH;

  while (nameWidth >= 140) {
    const fundsStartX = PAGE_LEFT_X + nameWidth + COLUMN_GAP + totalWidth + COLUMN_GAP;
    const availableWidth = PAGE_RIGHT_X - fundsStartX;
    const nextFundWidth = Math.floor(
      (availableWidth - COLUMN_GAP * (fundCount - 1)) / fundCount,
    );
    if (nextFundWidth >= MIN_FUND_COL_WIDTH) {
      fundWidth = nextFundWidth;
      break;
    }
    nameWidth -= 10;
  }

  const totalX = PAGE_LEFT_X + nameWidth + COLUMN_GAP;
  const fundsStartX = totalX + totalWidth + COLUMN_GAP;
  const fundColumns = fundTypeColumns.map((fundType, index) => ({
    id: fundType.id,
    name: fundType.name,
    x: fundsStartX + index * (fundWidth + COLUMN_GAP),
    width: fundWidth,
  }));

  return {
    nameX: PAGE_LEFT_X,
    nameWidth,
    totalX,
    totalWidth,
    fundColumns,
  };
}

function buildTotalPerDonorPdf({
  startDate,
  endDate,
  scopeLabel,
  filtersLabel,
  sections,
  fundTypeColumns,
}: {
  startDate: string;
  endDate: string;
  scopeLabel: string;
  filtersLabel: string;
  sections: Array<{
    currencyCode: string;
    rows: DonorTotalRow[];
    grandTotal: number;
    grandFundTotals: Map<number, number>;
  }>;
  fundTypeColumns: FundTypeColumn[];
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 0,
      compress: true,
      autoFirstPage: false,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const now = new Date();
    const generatedDateLine = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(now);
    const generatedTimeLine = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "UTC",
    }).format(now);
    const layout = buildReportLayout(fundTypeColumns);

    let pageNumber = 0;
    let rowY = ROW_START_Y;

    function drawHeaderRow() {
      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Name", layout.nameX, rowY - 21);
      doc.text("Total", layout.totalX, rowY - 21, { width: layout.totalWidth, align: "right" });
      layout.fundColumns.forEach((fundColumn) => {
        doc.text(getHeaderLabel(fundColumn.name, fundColumn.width), fundColumn.x, rowY - 21, {
          width: fundColumn.width,
          align: "right",
        });
      });
    }

    function startPage() {
      doc.addPage({ size: "LETTER", margin: 0 });
      pageNumber += 1;
      rowY = pageNumber === 1 ? ROW_START_Y : 52;

    if (pageNumber === 1) {
      doc.font("Helvetica-Bold").fontSize(18).text("Total per Donor", 40, 32);
      doc.font("Helvetica").fontSize(11).text(generatedDateLine, 447, 30, {
        width: 124,
        align: "right",
        });
        doc.font("Helvetica").fontSize(11).text(generatedTimeLine, 447, 44, {
          width: 124,
          align: "right",
        });
        doc.font("Helvetica").fontSize(15).text("From:", 40, 84);
        doc.font("Helvetica").fontSize(14).text(formatShortDateLabel(startDate), 118, 84);
        doc.font("Helvetica").fontSize(15).text("To:", 274, 84);
        doc.font("Helvetica").fontSize(14).text(formatShortDateLabel(endDate), 335, 84);
      doc.font("Helvetica").fontSize(11).text(`Scope: ${scopeLabel}`, 40, 109, {
        width: 530,
      });
      if (filtersLabel.trim()) {
        filtersLabel.split("\n").forEach((line, idx) => {
          doc.font("Helvetica").fontSize(10).text(line, 40, 125 + idx * 12, { width: 530 });
        });
        rowY += Math.max(filtersLabel.split("\n").length * 12, 14);
      }
    }
  }

    startPage();

    sections.forEach((section, sectionIndex) => {
      if (sectionIndex > 0 && rowY > ROW_END_Y - 70) {
        startPage();
      }

      doc.font("Helvetica-Bold").fontSize(11).text(`Currency: ${section.currencyCode}`, layout.nameX, rowY);
      rowY += 40;
      drawHeaderRow();

      section.rows.forEach((row) => {
        if (rowY > ROW_END_Y) {
          startPage();
          doc.font("Helvetica-Bold").fontSize(11).text(`Currency: ${section.currencyCode}`, layout.nameX, rowY);
          rowY += 40;
          drawHeaderRow();
        }

        doc.font("Helvetica").fontSize(11);
        doc.text(row.label.toUpperCase(), layout.nameX, rowY, { width: layout.nameWidth });
        doc.text(formatCurrency(row.totalAmount, section.currencyCode), layout.totalX, rowY, {
          width: layout.totalWidth,
          align: "right",
        });
        layout.fundColumns.forEach((fundColumn) => {
          doc.text(
            formatCurrency(row.fundTypeTotals.get(fundColumn.id) ?? 0, section.currencyCode),
            fundColumn.x,
            rowY,
            { width: fundColumn.width, align: "right" },
          );
        });
        rowY += ROW_HEIGHT;
      });

      if (rowY > 660) {
        startPage();
      }

      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("TOTAL", layout.totalX, rowY + 10, {
        width: layout.totalWidth,
        align: "right",
      });
      layout.fundColumns.forEach((fundColumn) => {
        doc.text(getHeaderLabel(fundColumn.name, fundColumn.width), fundColumn.x, rowY + 10, {
          width: fundColumn.width,
          align: "right",
        });
      });

      doc.font("Helvetica-Bold").fontSize(11);
      doc.text(formatCurrency(section.grandTotal, section.currencyCode), layout.totalX, rowY + 33, {
        width: layout.totalWidth,
        align: "right",
      });
      doc.font("Helvetica-Oblique").fontSize(11);
      layout.fundColumns.forEach((fundColumn) => {
        doc.text(
          formatCurrency(section.grandFundTotals.get(fundColumn.id) ?? 0, section.currencyCode),
          fundColumn.x,
          rowY + 33,
          { width: fundColumn.width, align: "right" },
        );
      });

      rowY += 78;
    });

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      const pageNumber = index - range.start + 1;
      doc.font("Times-Italic").fontSize(9).text(generatedDateLine, 72, 742, {
        lineBreak: false,
      });
      doc.font("Times-Italic").fontSize(9).text(`Page ${pageNumber} of ${range.count}`, 0, 742, {
        width: 540,
        align: "right",
        lineBreak: false,
      });
    }

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
    let activeCountryCodes: string[] = [];
    let memberQuery = supabase
      .from("emcmember")
      .select("id,fname,lname,householdid,spouseid,countrycode");

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

      memberQuery = memberQuery.in("countrycode", activeCountryCodes);
    } else if (requestedCountryCodes.length > 0) {
      activeCountryCodes = requestedCountryCodes;
      memberQuery = memberQuery.in("countrycode", requestedCountryCodes);
    }

    const { data: memberRows, error: memberErr } = await memberQuery.limit(5000);
    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 500 });
    }

    const scopedMembers = (memberRows ?? []) as ScopedMemberRow[];
    if (!scopedMembers.length) {
      return NextResponse.json({ error: "No donors were found in the selected scope." }, { status: 400 });
    }

    const households = buildHouseholdOptions(scopedMembers);
    const householdByMemberId = new Map<number, { label: string; representativeId: number }>();
    households.forEach((household) => {
      household.memberIds.forEach((memberId) => {
        householdByMemberId.set(memberId, {
          label: household.label,
          representativeId: household.value,
        });
      });
    });

    const { data: fundTypeRows, error: fundTypeErr } = await supabase
      .from("contribfundtype")
      .select("id,name")
      .order("name", { ascending: true });
    if (fundTypeErr) {
      return NextResponse.json({ error: fundTypeErr.message }, { status: 500 });
    }
    const { data: contributionTypeRows, error: contributionTypeErr } = await supabase
      .from("contribtype")
      .select("id,name")
      .order("name", { ascending: true });
    if (contributionTypeErr) {
      return NextResponse.json({ error: contributionTypeErr.message }, { status: 500 });
    }

    const fundTypeColumns = ((fundTypeRows ?? []) as LookupRow[])
      .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
      .map((row) => ({ id: row.id, name: row.name }));
    if (!fundTypeColumns.length) {
      return NextResponse.json({ error: "No contribution fund types are configured." }, { status: 400 });
    }

    const fundTypeNameById = new Map<number, string>(
      ((fundTypeRows ?? []) as LookupRow[])
        .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
        .map((row) => [row.id, row.name]),
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

    const scopedMemberIds = scopedMembers.map((row) => row.id);
    const contributionRows: ContributionBaseRow[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      let contributionQuery = supabase
        .from("contribcontribution")
        .select("memberid,amount,fundtypeid,currencycode,contributiontypeid")
        .in("memberid", scopedMemberIds)
        .gte("datedeposited", startDate)
        .lte("datedeposited", endDate)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (fundTypeFilterId) {
        contributionQuery = contributionQuery.eq("fundtypeid", fundTypeFilterId);
      }
      if (contributionTypeFilterId) {
        contributionQuery = contributionQuery.eq("contributiontypeid", contributionTypeFilterId);
      }

      const { data, error } = await contributionQuery;

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const pageRows = (data ?? []) as ContributionBaseRow[];
      contributionRows.push(...pageRows);
      if (pageRows.length < PAGE_SIZE) {
        break;
      }
    }

    if (!contributionRows.length) {
      return NextResponse.json({ error: "No contributions were found for the selected period." }, { status: 400 });
    }

    const rowsByCurrency = new Map<string, Map<number, DonorTotalRow>>();
    contributionRows.forEach((row) => {
      const household = householdByMemberId.get(row.memberid);
      if (!household) {
        return;
      }
      const currencyCode = normalizeCode(row.currencycode) || "USD";
      const rowsByRepresentativeId = rowsByCurrency.get(currencyCode) ?? new Map<number, DonorTotalRow>();

      const existing = rowsByRepresentativeId.get(household.representativeId) ?? {
        label: household.label,
        totalAmount: 0,
        fundTypeTotals: new Map<number, number>(),
      };

      const amount = Number(row.amount ?? 0);
      existing.totalAmount += amount;

      if (fundTypeNameById.has(row.fundtypeid)) {
        existing.fundTypeTotals.set(
          row.fundtypeid,
          (existing.fundTypeTotals.get(row.fundtypeid) ?? 0) + amount,
        );
      }

      rowsByRepresentativeId.set(household.representativeId, existing);
      rowsByCurrency.set(currencyCode, rowsByRepresentativeId);
    });

    const sections = [...rowsByCurrency.entries()]
      .map(([currencyCode, rowsByRepresentativeId]) => {
        const rows = [...rowsByRepresentativeId.values()].sort((a, b) =>
          normalizeName(a.label).localeCompare(normalizeName(b.label)),
        );
        const grandTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);
        const grandFundTotals = new Map<number, number>();
        fundTypeColumns.forEach((fundType) => {
          grandFundTotals.set(
            fundType.id,
            rows.reduce((sum, row) => sum + (row.fundTypeTotals.get(fundType.id) ?? 0), 0),
          );
        });
        return {
          currencyCode,
          rows,
          grandTotal,
          grandFundTotals,
        };
      })
      .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
    const scopeLabel = activeCountryCodes.length
      ? (await getCountryNamesForCodes(supabase, activeCountryCodes)).join(", ")
      : (await getContributionScopeSummary(access)).label;
    const filtersLabelParts: string[] = [];
    if (fundTypeParam) filtersLabelParts.push(`Fund Type: ${fundTypeParam}`);
    if (contributionTypeParam) filtersLabelParts.push(`Contribution Type: ${contributionTypeParam}`);
    const filtersLabel = filtersLabelParts.join("\n");

    const pdf = await buildTotalPerDonorPdf({
      startDate,
      endDate,
      scopeLabel,
      filtersLabel,
      sections,
      fundTypeColumns,
    });

    const filename = `total-per-donor-${startDate}-to-${endDate}.pdf`;
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate Total per Donor report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
