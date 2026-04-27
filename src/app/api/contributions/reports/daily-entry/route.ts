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

function buildDailyEntryPdf({
  dateEntered,
  rows,
  totalsByCurrency,
}: {
  dateEntered: string;
  rows: Array<{
    donorLabel: string;
    totalAmount: number;
    currencyCode: string;
    locationLabel: string;
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

    let pageNumber = 0;
    let rowY = 0;

    function startPage() {
      doc.addPage({ size: "LETTER", margin: 0 });
      pageNumber += 1;
      rowY = pageNumber === 1 ? 186 : 64;

      if (pageNumber === 1) {
        doc.font("Times-BoldItalic").fontSize(22).text(
          "Daily Entry Report - the Church of God - PKG",
          0,
          74,
          { width: doc.page.width, align: "center" },
        );
        doc.font("Times-BoldItalic").fontSize(16).text(
          "1-line Contribution Summary",
          0,
          108,
          { width: doc.page.width, align: "center" },
        );
        doc.font("Times-Italic").fontSize(16).text(
          `for ${formatShortDateLabel(dateEntered)}`,
          0,
          132,
          { width: doc.page.width, align: "center" },
        );
      }

      doc.font("Helvetica-Bold").fontSize(11);
      doc.text("Donor", 72, rowY - 24);
      doc.text("Total Amount", 280, rowY - 24, { width: 88, align: "right" });
      doc.text("Location", 380, rowY - 24);
      doc.moveTo(72, rowY - 6).lineTo(540, rowY - 6).strokeColor("#111827").lineWidth(1).stroke();
    }

    startPage();

    rows.forEach((row) => {
      if (rowY > 684) {
        startPage();
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

    doc.moveTo(72, rowY + 2).lineTo(540, rowY + 2).strokeColor("#c7d2fe").lineWidth(1).stroke();
    rowY += 14;
    doc.font("Helvetica-Bold").fontSize(11).text("Grand Total:", 72, rowY);

    if (totalsByCurrency.length <= 1) {
      const total = totalsByCurrency[0] ?? { currencyCode: "USD", totalAmount: 0 };
      doc.text(formatCurrency(total.totalAmount, total.currencyCode), 280, rowY, {
        width: 88,
        align: "right",
      });
    } else {
      totalsByCurrency.forEach((total, index) => {
        doc.text(
          `${total.currencyCode}: ${formatCurrency(total.totalAmount, total.currencyCode)}`,
          280,
          rowY + index * 14,
          { width: 88, align: "right" },
        );
      });
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

  if (!access.memberId) {
    return NextResponse.json(
      { error: "No member record is linked to this contribution account." },
      { status: 400 },
    );
  }

  try {
    const dateEnteredParam = String(request.nextUrl.searchParams.get("dateEntered") ?? "").trim();
    const dateEntered = isValidDateOnly(dateEnteredParam) ? dateEnteredParam : todayDateString();
    const summary = await getDailyEntrySummary(
      createServiceRoleClient(),
      access.memberId,
      dateEntered,
    );

    if (!summary.rows.length) {
      return NextResponse.json(
        { error: "No contributions were entered by you today." },
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
