import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { getContributionAccess } from "@/lib/contributions";
import { buildHouseholdOptions } from "@/lib/households";
import { getCountryNameByCodeMap } from "@/lib/report-country-cache";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;
const ROW_HEIGHT = 18;

type ScopedMemberRow = {
  id: number;
  fname: string | null;
  lname: string | null;
  householdid: number | null;
  spouseid: number | null;
  address: string | null;
  address2: string | null;
  city: string | null;
  statecode: string | null;
  zip: string | null;
  countrycode: string | null;
};

type ContributionBaseRow = {
  id: number;
  memberid: number;
  amount: number | string;
  checkno: string | null;
  datedeposited: string;
  fundtypeid: number;
  contributiontypeid: number;
  currencycode: string | null;
};

type LookupRow = {
  id: number;
  name: string | null;
};

type ContributionTypeRow = LookupRow & {
  taxdeductable: boolean | null;
};

type DonorSectionRow = {
  dateDeposited: string;
  contributionType: string;
  amount: number;
  currencyCode: string;
  fundType: string;
  checkNo: string | null;
};

type DonorSection = {
  label: string;
  representative: ScopedMemberRow;
  rows: DonorSectionRow[];
  totalsByCurrency: Map<string, number>;
  locale: string;
};

type PageSize = "LETTER" | "A4";

function isValidDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function formatShortDateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatAddressLine(row: ScopedMemberRow) {
  return [row.city, row.statecode, row.zip].filter(Boolean).join(", ");
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

function normalizeLocale(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function pageSizeForLocale(locale: string): PageSize {
  const normalized = normalizeLocale(locale).toLowerCase();
  if (normalized.startsWith("en-us") || normalized.startsWith("en-ca")) {
    return "LETTER";
  }
  return "A4";
}

function pageLayoutForSize(size: PageSize) {
  if (size === "A4") {
    return {
      firstRowY: 267,
      continuationRowY: 60,
      lastRowY: 740,
      bottomTextY: 778,
    };
  }
  return {
    firstRowY: 267,
    continuationRowY: 60,
    lastRowY: 690,
    bottomTextY: 728,
  };
}

function isMissingRelationError(error: { message?: string | null } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
}

function textForLocale(locale: string) {
  const base = locale.toLowerCase();
  if (base.startsWith("nl")) {
    return {
      orgLine1: "Stichting The Church of God,",
      orgLine2: "Preparing for the Kingdom of God",
      orgLine3: "5151 HV Drunen",
      fromLabel: "Van",
      toLabel: "Tot",
      officialReceipt: "Dit is een officiëel ontvangstbewijs voor de belastingdienst.",
      dateHeader: "Datum",
      fundHeader: "Fonds",
      dedHeader: "Ded.",
      fundTypeHeader: "Eenheid",
      checkNoHeader: "Cheque nr.",
      amountHeader: "Bedrag",
      grandTotalLabel: "Totaal",
      noGoodsOrServices: "Er zijn geen goederen of diensten geleverd voor het geschonken bedrag.",
    };
  }

  return {
    orgLine1: "the Church of God - PKG, inc",
    orgLine2: "P.O. Box 14447",
    orgLine3: "Cincinnati, OH 45250",
    fromLabel: "From",
    toLabel: "-",
    officialReceipt: "This is an official receipt for tax purposes.",
    dateHeader: "Date",
    fundHeader: "Fund",
    dedHeader: "Ded.",
    fundTypeHeader: "Fund Type",
    checkNoHeader: "Check No.",
    amountHeader: "Amount",
    grandTotalLabel: "Grand Total",
    noGoodsOrServices: "No goods or services were provided in exchange for money given.",
  };
}

function formatFundTypeForLocale(fundType: string, locale: string) {
  const base = locale.toLowerCase();
  if (!base.startsWith("nl")) {
    return fundType;
  }

  const normalized = normalizeName(fundType);
  if (normalized === "cash") return "Contant";
  if (normalized === "bank transfer") return "Bankoverschrijving";
  if (normalized === "check") return "Cheque";
  return fundType;
}

function drawQuarterlyHeader(
  doc: PDFKit.PDFDocument,
  startDate: string,
  endDate: string,
  generatedDate: string,
  locale: string,
  donor: DonorSection,
  countryNameByCode: Map<string, string>,
  showCheckNo: boolean,
) {
  const t = textForLocale(locale);
  const amountX = showCheckNo ? 428 : 400;
  const amountWidth = showCheckNo ? 56 : 84;
  const fundTypeWidth = showCheckNo ? 60 : 95;

  doc.font("Helvetica-Bold").fontSize(12).text(t.orgLine1, 0, 57, {
    width: doc.page.width,
    align: "center",
  });
  doc.font("Helvetica").fontSize(11).text(generatedDate, 430, 40);
  doc.font("Helvetica-Bold").fontSize(12).text(t.orgLine2, 0, 75, {
    width: doc.page.width,
    align: "center",
  });
  doc.font("Helvetica-Bold").fontSize(12).text(t.orgLine3, 0, 92, {
    width: doc.page.width,
    align: "center",
  });

  doc.font("Helvetica").fontSize(12).text(
    `${t.fromLabel} ${formatShortDateLabel(startDate, locale)} ${t.toLabel} ${formatShortDateLabel(endDate, locale)}`,
    0,
    111,
    {
      width: doc.page.width,
      align: "center",
    },
  );
  doc.font("Helvetica").fontSize(11).text(t.officialReceipt, 29, 132);

  doc.font("Helvetica-Bold").fontSize(10).text(donor.label.toUpperCase(), 35, 189);

  const addressLines = [
    donor.representative.address,
    donor.representative.address2,
    formatAddressLine(donor.representative),
    countryNameByCode.get(normalizeCode(donor.representative.countrycode)) ??
      donor.representative.countrycode,
  ].filter(Boolean) as string[];

  let addressY = 201;
  for (const line of addressLines) {
    doc.font("Helvetica").fontSize(10).text(line, 35, addressY);
    addressY += 12;
  }

  doc.font("Helvetica-Bold").fontSize(10);
  doc.text(t.dateHeader, 49, 249);
  doc.text(t.fundHeader, 137, 249);
  doc.text(t.dedHeader, 224, 249);
  doc.text(t.fundTypeHeader, 295, 249, { width: fundTypeWidth });
  if (showCheckNo) {
    doc.text(t.checkNoHeader, 367, 249);
  }
  doc.text(t.amountHeader, amountX, 249, { width: amountWidth, align: "right" });
}

function drawQuarterlyFooter(
  doc: PDFKit.PDFDocument,
  locale: string,
  totalsByCurrency: Map<string, number>,
  totalY: number,
  bottomTextY: number,
) {
  const t = textForLocale(locale);
  const rows = [...totalsByCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
  let y = totalY;
  rows.forEach(([currencyCode, totalAmount]) => {
    doc.font("Helvetica-Bold").fontSize(11).text(`${t.grandTotalLabel} (${currencyCode}):`, 280, y);
    doc.text(formatCurrency(totalAmount, currencyCode), 428, y, {
      width: 56,
      align: "right",
    });
    y += 14;
  });
  doc.font("Helvetica").fontSize(11).text(t.noGoodsOrServices, 26, bottomTextY);
}

function buildQuarterlyPdf({
  startDate,
  endDate,
  sections,
  countryNameByCode,
  showCheckNo,
}: {
  startDate: string;
  endDate: string;
  sections: DonorSection[];
  countryNameByCode: Map<string, string>;
  showCheckNo: boolean;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 0,
      compress: true,
      autoFirstPage: false,
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    sections.forEach((section) => {
      const locale = section.locale;
      const pageSize = pageSizeForLocale(locale);
      const layout = pageLayoutForSize(pageSize);
      let rowY = layout.firstRowY;
      const amountX = showCheckNo ? 428 : 400;
      const amountWidth = showCheckNo ? 56 : 84;
      const fundTypeWidth = showCheckNo ? 60 : 95;
      const generatedDate = new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date());

      function startSectionPage(withHeader: boolean) {
        doc.addPage({ size: pageSize, margin: 0 });
        if (withHeader) {
          drawQuarterlyHeader(
            doc,
            startDate,
            endDate,
            generatedDate,
            locale,
            section,
            countryNameByCode,
            showCheckNo,
          );
          rowY = layout.firstRowY;
        } else {
          rowY = layout.continuationRowY;
        }
      }

      startSectionPage(true);

      section.rows.forEach((row) => {
        if (rowY > layout.lastRowY) {
          startSectionPage(false);
        }

        doc.font("Helvetica").fontSize(10);
        doc.text(formatShortDateLabel(row.dateDeposited, locale), 35, rowY);
        doc.text(row.contributionType, 101, rowY, { width: 95 });
        doc.text("Y", 229, rowY, { width: 15, align: "center" });
        doc.text(formatFundTypeForLocale(row.fundType, locale), 295, rowY, {
          width: fundTypeWidth,
        });
        if (showCheckNo && row.checkNo) {
          doc.text(row.checkNo, 367, rowY, { width: 60 });
        }
        doc.text(formatCurrency(row.amount, row.currencyCode), amountX, rowY + 1, {
          width: amountWidth,
          align: "right",
        });

        rowY += ROW_HEIGHT;
      });

      if (rowY > layout.lastRowY) {
        startSectionPage(false);
      }

      drawQuarterlyFooter(
        doc,
        locale,
        section.totalsByCurrency,
        rowY + 4,
        layout.bottomTextY,
      );
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
    const memberIdParam = Number(request.nextUrl.searchParams.get("memberId"));
    const memberIdFilter =
      Number.isInteger(memberIdParam) && memberIdParam > 0 ? memberIdParam : null;
    const deductibleOnly =
      String(request.nextUrl.searchParams.get("deductibleOnly") ?? "").trim().toLowerCase() ===
      "true";
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
    const requestedCountryCodes = Array.from(
      new Set(
        request.nextUrl.searchParams
          .getAll("country")
          .map((value) => normalizeCode(value))
          .filter(Boolean),
      ),
    );
    let memberQuery = supabase
      .from("emcmember")
      .select("id,fname,lname,householdid,spouseid,address,address2,city,statecode,zip,countrycode");

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

      const activeCountryCodes =
        requestedCountryCodes.length > 0 ? requestedCountryCodes : access.allowedCountryCodes;
      if (!activeCountryCodes.length) {
        return NextResponse.json(
          { error: "Select at least one country." },
          { status: 400 },
        );
      }

      memberQuery = memberQuery.in("countrycode", activeCountryCodes);
    } else if (requestedCountryCodes.length > 0) {
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
    let filteredHouseholds = households;

    if (memberIdFilter) {
      const match = households.find((household) => household.memberIds.includes(memberIdFilter));
      if (!match) {
        return NextResponse.json({ error: "Donor not found in scope." }, { status: 404 });
      }
      filteredHouseholds = [match];
    }

    const householdByMemberId = new Map<number, { label: string; memberIds: number[]; representativeId: number }>();
    filteredHouseholds.forEach((household) => {
      household.memberIds.forEach((memberId) => {
        householdByMemberId.set(memberId, {
          label: household.label,
          memberIds: household.memberIds,
          representativeId: household.value,
        });
      });
    });

    const scopedMemberIds = filteredHouseholds.flatMap((h) => h.memberIds);
    const [
      { data: fundTypeRows, error: fundTypeErr },
      { data: contributionTypeRows, error: contributionTypeErr },
    ] = await Promise.all([
      supabase.from("contribfundtype").select("id,name").order("name", { ascending: true }),
      supabase
        .from("contribtype")
        .select("id,name,taxdeductable")
        .order("name", { ascending: true }),
    ]);

    if (fundTypeErr) {
      return NextResponse.json({ error: fundTypeErr.message }, { status: 500 });
    }
    if (contributionTypeErr) {
      return NextResponse.json({ error: contributionTypeErr.message }, { status: 500 });
    }
    const deductibleContributionTypeIds = new Set<number>(
      ((contributionTypeRows ?? []) as ContributionTypeRow[])
        .filter((row) => row.taxdeductable)
        .map((row) => row.id),
    );
    const fundTypeNameById = new Map<number, string>(
      ((fundTypeRows ?? []) as LookupRow[])
        .filter((row): row is LookupRow & { name: string } => Boolean(row.name))
        .map((row) => [row.id, row.name]),
    );
    const contributionTypeNameById = new Map<number, string>(
      ((contributionTypeRows ?? []) as ContributionTypeRow[])
        .filter((row): row is ContributionTypeRow & { name: string } => Boolean(row.name))
        .map((row) => [row.id, row.name]),
    );
    let countryNameByCode = new Map<string, string>();
    try {
      countryNameByCode = await getCountryNameByCodeMap(supabase);
    } catch (countryError) {
      return NextResponse.json(
        { error: countryError instanceof Error ? countryError.message : "Failed to load countries." },
        { status: 500 },
      );
    }

    const contributionRows: ContributionBaseRow[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      let query = supabase
        .from("contribcontribution")
        .select("id,memberid,amount,checkno,datedeposited,fundtypeid,contributiontypeid,currencycode")
        .in("memberid", scopedMemberIds)
        .gte("datedeposited", startDate)
        .lte("datedeposited", endDate)
        .order("memberid", { ascending: true })
        .order("datedeposited", { ascending: true })
        .order("id", { ascending: true });

      if (deductibleOnly) {
        query = query.in("contributiontypeid", [...deductibleContributionTypeIds]);
      }

      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

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
      const scopeLabel = deductibleOnly ? "tax-deductible contributions" : "contributions";
      return NextResponse.json(
        { error: `No ${scopeLabel} were found for the selected period.` },
        { status: 400 },
      );
    }

    const memberById = new Map<number, ScopedMemberRow>(scopedMembers.map((row) => [row.id, row]));
    const sectionsByRepresentativeId = new Map<number, DonorSection>();

    contributionRows.forEach((row) => {
      const household = householdByMemberId.get(row.memberid);
      const member = memberById.get(row.memberid);
      if (!household || !member) {
        return;
      }

      const representative = memberById.get(household.representativeId) ?? member;
      const existing = sectionsByRepresentativeId.get(household.representativeId) ?? {
        label: household.label,
        representative,
        rows: [],
        totalsByCurrency: new Map<string, number>(),
        locale: "en-US",
      };
      const currencyCode = normalizeCode(row.currencycode) || "USD";

      existing.rows.push({
        dateDeposited: row.datedeposited,
        contributionType:
          contributionTypeNameById.get(row.contributiontypeid) ?? String(row.contributiontypeid),
        amount: Number(row.amount),
        currencyCode,
        fundType: fundTypeNameById.get(row.fundtypeid) ?? String(row.fundtypeid),
        checkNo: row.checkno,
      });
      existing.totalsByCurrency.set(
        currencyCode,
        (existing.totalsByCurrency.get(currencyCode) ?? 0) + Number(row.amount),
      );
      sectionsByRepresentativeId.set(household.representativeId, existing);
    });

    const sections = [...sectionsByRepresentativeId.values()].sort((a, b) =>
      normalizeName(a.label).localeCompare(normalizeName(b.label)),
    );

    const representativeCountryCodes = Array.from(
      new Set(
        scopedMembers
          .map((row) => normalizeCode(row.countrycode))
          .filter(Boolean),
      ),
    );
    const { data: localeRows, error: localeErr } = await supabase
      .from("contribcountrylocale")
      .select("countrycode,locale")
      .in("countrycode", representativeCountryCodes.length ? representativeCountryCodes : ["__none__"]);
    if (localeErr && !isMissingRelationError(localeErr)) {
      return NextResponse.json({ error: localeErr.message }, { status: 500 });
    }
    const localeByCountryCode = new Map<string, string>(
      ((localeRows ?? []) as Array<{ countrycode: string | null; locale: string | null }>)
        .map((row) => [normalizeCode(row.countrycode), normalizeLocale(row.locale)] as const)
        .filter(([countryCode, locale]) => Boolean(countryCode && locale)),
    );

    const pdf = await buildQuarterlyPdf({
      startDate,
      endDate,
      sections: sections.map((section) => ({
        ...section,
        locale:
          localeByCountryCode.get(normalizeCode(section.representative.countrycode)) ?? "en-US",
      })),
      countryNameByCode,
      showCheckNo: sections.some((section) =>
        section.rows.some((row) => String(row.checkNo ?? "").trim() !== ""),
      ),
    });

    const filename = `tax-receipts-${startDate}-to-${endDate}.pdf`;
    return new Response(pdf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate Quarterly report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
