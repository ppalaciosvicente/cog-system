import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { getContributionAccess } from "@/lib/contributions";
import { sendTaxReceiptEmail } from "@/lib/email/tax-receipt";
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
  email: string | null;
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

type ContributionAccessOk = {
  ok: true;
  isAdmin: boolean;
  allowedCountryCodes: string[];
};

type TaxReceiptPreviewRow = {
  representativeId: number;
  memberName: string;
  email: string;
  address: string;
  canSendEmail: boolean;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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

function formatFirstLastName(row: Pick<ScopedMemberRow, "fname" | "lname">) {
  return [row.fname, row.lname]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
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

function formatContributionTypeForLocale(contributionType: string, locale: string) {
  const base = locale.toLowerCase();
  if (!base.startsWith("nl")) {
    return contributionType;
  }

  const normalized = normalizeName(contributionType);
  if (normalized === "tithe/offering") return "Tiende/Offer";
  return contributionType;
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
        doc.text(formatContributionTypeForLocale(row.contributionType, locale), 101, rowY, {
          width: 95,
        });
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

async function loadTaxReceiptData(args: {
  access: ContributionAccessOk;
  startDate: string;
  endDate: string;
  requestedCountryCodes: string[];
  memberIdFilter: number | null;
  deductibleOnly: boolean;
}) {
  const { access, startDate, endDate, requestedCountryCodes, memberIdFilter, deductibleOnly } =
    args;
  const supabase = createServiceRoleClient();
  let memberQuery = supabase
    .from("emcmember")
    .select(
      "id,fname,lname,householdid,spouseid,address,address2,city,statecode,zip,countrycode,email",
    );

  if (!access.isAdmin) {
    if (!access.allowedCountryCodes.length) {
      throw new HttpError(400, "No contribution regions are assigned to this account yet.");
    }
    if (requestedCountryCodes.length > 0) {
      const invalidCodes = requestedCountryCodes.filter(
        (code) => !access.allowedCountryCodes.includes(code),
      );
      if (invalidCodes.length > 0) {
        throw new HttpError(400, "One or more selected countries are outside your scope.");
      }
    }

    const activeCountryCodes =
      requestedCountryCodes.length > 0 ? requestedCountryCodes : access.allowedCountryCodes;
    if (!activeCountryCodes.length) {
      throw new HttpError(400, "Select at least one country.");
    }
    memberQuery = memberQuery.in("countrycode", activeCountryCodes);
  } else if (requestedCountryCodes.length > 0) {
    memberQuery = memberQuery.in("countrycode", requestedCountryCodes);
  }

  const { data: memberRows, error: memberErr } = await memberQuery.limit(5000);
  if (memberErr) throw new Error(memberErr.message);

  const scopedMembers = (memberRows ?? []) as ScopedMemberRow[];
  if (!scopedMembers.length) {
    throw new HttpError(400, "No donors were found in the selected scope.");
  }

  const households = buildHouseholdOptions(scopedMembers);
  let filteredHouseholds = households;
  if (memberIdFilter) {
    const match = households.find((household) => household.memberIds.includes(memberIdFilter));
    if (!match) throw new HttpError(404, "Donor not found in scope.");
    filteredHouseholds = [match];
  }

  const householdByMemberId = new Map<
    number,
    { label: string; memberIds: number[]; representativeId: number }
  >();
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
  if (fundTypeErr) throw new Error(fundTypeErr.message);
  if (contributionTypeErr) throw new Error(contributionTypeErr.message);

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
  countryNameByCode = await getCountryNameByCodeMap(supabase);

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
    if (error) throw new Error(error.message);

    const pageRows = (data ?? []) as ContributionBaseRow[];
    contributionRows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }

  if (!contributionRows.length) {
    const scopeLabel = deductibleOnly ? "tax-deductible contributions" : "contributions";
    throw new HttpError(400, `No ${scopeLabel} were found for the selected period.`);
  }

  const memberById = new Map<number, ScopedMemberRow>(scopedMembers.map((row) => [row.id, row]));
  const sectionsByRepresentativeId = new Map<number, DonorSection>();
  contributionRows.forEach((row) => {
    const household = householdByMemberId.get(row.memberid);
    const member = memberById.get(row.memberid);
    if (!household || !member) return;

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
    new Set(scopedMembers.map((row) => normalizeCode(row.countrycode)).filter(Boolean)),
  );
  const { data: localeRows, error: localeErr } = await supabase
    .from("contribcountrylocale")
    .select("countrycode,locale")
    .in("countrycode", representativeCountryCodes.length ? representativeCountryCodes : ["__none__"]);
  if (localeErr && !isMissingRelationError(localeErr)) {
    throw new Error(localeErr.message);
  }
  const localeByCountryCode = new Map<string, string>(
    ((localeRows ?? []) as Array<{ countrycode: string | null; locale: string | null }>)
      .map((row) => [normalizeCode(row.countrycode), normalizeLocale(row.locale)] as const)
      .filter(([countryCode, locale]) => Boolean(countryCode && locale)),
  );

  return {
    startDate,
    endDate,
    sections,
    localeByCountryCode,
    countryNameByCode,
  };
}

function parseRequestedCountryCodes(values: string[]) {
  return Array.from(new Set(values.map((value) => normalizeCode(value)).filter(Boolean)));
}

function formatPostalAddress(row: ScopedMemberRow, countryNameByCode: Map<string, string>) {
  return [
    row.address,
    row.address2,
    formatAddressLine(row),
    countryNameByCode.get(normalizeCode(row.countrycode)) ?? row.countrycode ?? "",
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function toPreviewRows(
  sections: DonorSection[],
  countryNameByCode: Map<string, string>,
): TaxReceiptPreviewRow[] {
  return sections.map((section) => {
    const email = String(section.representative.email ?? "").trim();
    return {
      representativeId: section.representative.id,
      memberName: section.label,
      email,
      address: formatPostalAddress(section.representative, countryNameByCode),
      canSendEmail: Boolean(email),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const accessRaw = await getContributionAccess(request);
    if (!accessRaw.ok) {
      return NextResponse.json({ error: accessRaw.error }, { status: accessRaw.status });
    }
    const access = accessRaw as ContributionAccessOk;

    const startDate = String(request.nextUrl.searchParams.get("startDate") ?? "").trim();
    const endDate = String(request.nextUrl.searchParams.get("endDate") ?? "").trim();
    const memberIdParam = Number(request.nextUrl.searchParams.get("memberId"));
    const memberIdFilter =
      Number.isInteger(memberIdParam) && memberIdParam > 0 ? memberIdParam : null;
    const deductibleOnly =
      String(request.nextUrl.searchParams.get("deductibleOnly") ?? "").trim().toLowerCase() ===
      "true";
    const preview =
      String(request.nextUrl.searchParams.get("preview") ?? "").trim().toLowerCase() === "true";

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

    const requestedCountryCodes = parseRequestedCountryCodes(
      request.nextUrl.searchParams.getAll("country"),
    );
    const data = await loadTaxReceiptData({
      access,
      startDate,
      endDate,
      requestedCountryCodes,
      memberIdFilter,
      deductibleOnly,
    });

    if (preview) {
      return NextResponse.json({
        recipients: toPreviewRows(data.sections, data.countryNameByCode),
      });
    }

    const sectionsWithLocale = data.sections.map((section) => ({
      ...section,
      locale: data.localeByCountryCode.get(normalizeCode(section.representative.countrycode)) ?? "en-US",
    }));
    const pdf = await buildQuarterlyPdf({
      startDate,
      endDate,
      sections: sectionsWithLocale,
      countryNameByCode: data.countryNameByCode,
      showCheckNo: sectionsWithLocale.some((section) =>
        section.rows.some((row) => String(row.checkNo ?? "").trim() !== ""),
      ),
    });

    const filename = `tax-receipts-${startDate}-to-${endDate}.pdf`;
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate Quarterly report.";
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessRaw = await getContributionAccess(request);
    if (!accessRaw.ok) {
      return NextResponse.json({ error: accessRaw.error }, { status: accessRaw.status });
    }
    const access = accessRaw as ContributionAccessOk;

    const body = (await request.json().catch(() => ({}))) as {
      startDate?: string;
      endDate?: string;
      countries?: string[];
      representativeIds?: number[];
    };
    const startDate = String(body.startDate ?? "").trim();
    const endDate = String(body.endDate ?? "").trim();
    const requestedCountryCodes = parseRequestedCountryCodes(body.countries ?? []);
    const representativeIds = Array.from(
      new Set((body.representativeIds ?? []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
    );

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
    if (!representativeIds.length) {
      return NextResponse.json({ error: "Select at least one member to send." }, { status: 400 });
    }

    const data = await loadTaxReceiptData({
      access,
      startDate,
      endDate,
      requestedCountryCodes,
      memberIdFilter: null,
      deductibleOnly: true,
    });

    const sectionByRepresentativeId = new Map<number, DonorSection>(
      data.sections.map((section) => [section.representative.id, section]),
    );
    const sent: string[] = [];
    const missingEmail: string[] = [];
    const failed: Array<{ memberName: string; email: string; error: string }> = [];

    for (const representativeId of representativeIds) {
      const section = sectionByRepresentativeId.get(representativeId);
      if (!section) {
        failed.push({
          memberName: `Representative #${representativeId}`,
          email: "",
          error: "Recipient not found in current scope.",
        });
        continue;
      }

      const memberName = section.label;
      const recipientGreetingName =
        formatFirstLastName(section.representative) || memberName;
      const email = String(section.representative.email ?? "").trim();
      if (!email) {
        missingEmail.push(memberName);
        continue;
      }

      try {
        const sectionWithLocale = {
          ...section,
          locale:
            data.localeByCountryCode.get(normalizeCode(section.representative.countrycode)) ??
            "en-US",
        };
        const pdf = await buildQuarterlyPdf({
          startDate,
          endDate,
          sections: [sectionWithLocale],
          countryNameByCode: data.countryNameByCode,
          showCheckNo: section.rows.some((row) => String(row.checkNo ?? "").trim() !== ""),
        });
        const filename = `tax-receipt-${representativeId}-${startDate}-to-${endDate}.pdf`;
        await sendTaxReceiptEmail({
          to: email,
          recipientName: recipientGreetingName,
          startDate,
          endDate,
          pdf,
          filename,
        });
        sent.push(memberName);
      } catch (sendError) {
        failed.push({
          memberName,
          email,
          error: sendError instanceof Error ? sendError.message : "Unknown email send error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      requested: representativeIds.length,
      sentCount: sent.length,
      failedCount: failed.length,
      missingEmailCount: missingEmail.length,
      sent,
      missingEmail,
      failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send tax receipt emails.";
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
