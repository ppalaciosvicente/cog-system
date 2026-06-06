import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { getContributionAccess } from "@/lib/contributions";
import {
  formatCurrency,
  formatShortDateLabel,
  getDailyEntrySummary,
  todayDateString,
} from "@/lib/contribution-daily-entry";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function isValidDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeCode(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function buildDailyEntryPdf({
  dateEntered,
  batches,
  totalsByCurrency,
}: {
  dateEntered: string;
  batches: Array<{
    batchNumber: number;
    dateDeposited: string;
    rows: Array<{
      donorLabel: string;
      totalAmount: number;
      currencyCode: string;
      locationLabel: string;
    }>;
    totalsByCurrency: Array<{ currencyCode: string; totalAmount: number }>;
  }>;
  totalsByCurrency: Array<{ currencyCode: string; totalAmount: number }>;
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

    let rowY = 0;
    const footerTopY = 742;

    function drawTotals(
      label: string,
      totals: Array<{ currencyCode: string; totalAmount: number }>,
    ) {
      doc.moveTo(72, rowY + 2).lineTo(540, rowY + 2).strokeColor("#c7d2fe").lineWidth(1).stroke();
      rowY += 14;
      doc.font("Helvetica-Bold").fontSize(11).text(`${label}:`, 72, rowY);

      if (totals.length <= 1) {
        const total = totals[0] ?? { currencyCode: "USD", totalAmount: 0 };
        doc.text(formatCurrency(total.totalAmount, total.currencyCode), 280, rowY, {
          width: 88,
          align: "right",
        });
        rowY += 18;
        return;
      }

      totals.forEach((total, index) => {
        doc.text(
          `${total.currencyCode}: ${formatCurrency(total.totalAmount, total.currencyCode)}`,
          280,
          rowY + index * 14,
          { width: 96, align: "right" },
        );
      });
      rowY += totals.length * 14 + 4;
    }

    function totalsBlockHeight(totals: Array<{ currencyCode: string; totalAmount: number }>) {
      return 14 + (totals.length <= 1 ? 18 : totals.length * 14 + 4);
    }

    function drawGrandTotalTitle(y: number) {
      doc.font("Times-Italic").fontSize(16).text(
        `Grand Total for date entered: ${formatShortDateLabel(dateEntered)}`,
        0,
        y,
        { width: doc.page.width, align: "center" },
      );
    }

    function startPage(batch: { batchNumber: number; dateDeposited: string }) {
      doc.addPage({ size: "LETTER", margin: 0 });
      rowY = 186;

      doc.font("Times-BoldItalic").fontSize(22).text(
        "Daily Entry Report - the Church of God - PKG",
        0,
        74,
        { width: doc.page.width, align: "center" },
      );
      doc.font("Times-BoldItalic").fontSize(16).text(
        `1-line Contribution Summary (Date entered: ${formatShortDateLabel(dateEntered)})`,
        0,
        108,
        { width: doc.page.width, align: "center" },
      );
      doc.font("Times-Italic").fontSize(16).text(
        `Date deposited: ${formatShortDateLabel(batch.dateDeposited)} - Batch ${batch.batchNumber}`,
        0,
        132,
        { width: doc.page.width, align: "center" },
      );

      doc.font("Helvetica-Bold").fontSize(11);
      doc.text("Donor", 72, rowY - 24);
      doc.text("Total Amount", 280, rowY - 24, { width: 88, align: "right" });
      doc.text("Location", 380, rowY - 24);
      doc.moveTo(72, rowY - 6).lineTo(540, rowY - 6).strokeColor("#111827").lineWidth(1).stroke();
    }

    batches.forEach((batch) => {
      startPage(batch);

      batch.rows.forEach((row) => {
        if (rowY > 684) {
          startPage(batch);
        }

        doc.font("Helvetica").fontSize(10.5);
        doc.text(row.donorLabel.toUpperCase(), 72, rowY, { width: 188 });
        doc.text(formatCurrency(row.totalAmount, row.currencyCode), 280, rowY, {
          width: 88,
          align: "right",
        });
        doc.text(row.locationLabel, 380, rowY, { width: 140 });
        rowY += 24;
      });

      drawTotals(`Batch ${batch.batchNumber} Total`, batch.totalsByCurrency);
    });

    if (batches.length > 1) {
      const inlineGrandTotalHeight = 40 + totalsBlockHeight(totalsByCurrency);
      if (rowY + inlineGrandTotalHeight <= footerTopY - 12) {
        rowY = Math.max(rowY + 22, footerTopY - 12 - inlineGrandTotalHeight);
        drawGrandTotalTitle(rowY);
        rowY += 30;
      } else {
        doc.addPage({ size: "LETTER", margin: 0 });
        rowY = 186;
        doc.font("Times-BoldItalic").fontSize(22).text(
          "Daily Entry Report - the Church of God - PKG",
          0,
          74,
          { width: doc.page.width, align: "center" },
        );
        drawGrandTotalTitle(120);
      }
      drawTotals("Grand Total", totalsByCurrency);
    }

    const footerDate = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date());
    const pageRange = doc.bufferedPageRange();
    for (let index = 0; index < pageRange.count; index += 1) {
      doc.switchToPage(index);
      doc.font("Times-Italic").fontSize(9).text(footerDate, 72, 742, { lineBreak: false });
      doc.font("Times-Italic").fontSize(9).text(
        `Page ${index + 1} of ${pageRange.count}`,
        0,
        742,
        {
          width: 540,
          align: "right",
          lineBreak: false,
        },
      );
    }

    doc.end();
  });
}

export async function GET(request: NextRequest) {
  const access = await getContributionAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const dateEnteredParam = String(request.nextUrl.searchParams.get("dateEntered") ?? "").trim();
    const dateEntered = isValidDateOnly(dateEnteredParam) ? dateEnteredParam : todayDateString();
    const scopeParam = String(request.nextUrl.searchParams.get("scope") ?? "").trim();
    const countryCode = normalizeCode(request.nextUrl.searchParams.get("country"));
    const includeAllContributors = access.isAdmin && scopeParam === "all";

    if (!includeAllContributors && !access.memberId) {
      return NextResponse.json(
        { error: "No member record is linked to this contribution account." },
        { status: 400 },
      );
    }

    if (!access.isAdmin && countryCode && !access.allowedCountryCodes.includes(countryCode)) {
      return NextResponse.json(
        { error: "Selected country is outside your scope." },
        { status: 400 },
      );
    }

    const summary = await getDailyEntrySummary(
      createServiceRoleClient(),
      includeAllContributors ? null : access.memberId,
      dateEntered,
      { countryCode: countryCode || null },
    );

    if (!summary.rows.length) {
      return NextResponse.json(
        {
          error: includeAllContributors
            ? "No contributions were entered on the selected date."
            : "No contributions were entered by you on the selected date.",
        },
        { status: 400 },
      );
    }

    const pdf = await buildDailyEntryPdf(summary);
    const filename = `daily-entry-report-${summary.dateEntered}.pdf`;

    return new NextResponse(pdf as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate Daily Entry Report." },
      { status: 500 },
    );
  }
}
