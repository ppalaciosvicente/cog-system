function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

type PdfLine = {
  text: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  x?: number;
  y?: number;
  align?: "left" | "center" | "right";
};

type BuildPdfOptions = {
  landscape?: boolean;
};

export function buildSimplePdf(lines: PdfLine[], options?: BuildPdfOptions) {
  const baseWidth = 612.11;
  const baseHeight = 792.17;
  const landscape = options?.landscape ?? false;
  const pageWidth = landscape ? baseHeight : baseWidth;
  const pageHeight = landscape ? baseWidth : baseHeight;
  let y = pageHeight - 44;
  const content: string[] = [];

  for (const line of lines) {
    const size = line.size ?? 12;
    const font =
      line.bold && line.italic
        ? "F4"
        : line.bold
          ? "F2"
          : line.italic
            ? "F3"
            : "F1";
    const text = escapePdfText(line.text);
    const x = line.x ?? 54;
    const nextY = line.y ?? y;
    const align = line.align ?? "left";
    if (align === "center") {
      content.push(
        `BT /${font} ${size} Tf (${text}) stringwidth pop 2 div neg ${pageWidth / 2} ${nextY} Td (${text}) Tj ET`,
      );
    } else if (align === "right") {
      content.push(
        `BT /${font} ${size} Tf (${text}) stringwidth pop neg ${x} add ${nextY} Td (${text}) Tj ET`,
      );
    } else {
      content.push(`BT /${font} ${size} Tf ${x} ${nextY} Td (${text}) Tj ET`);
    }
    if (line.y == null) {
      y -= size + 10;
    }
  }

  const stream = content.join("\n");
  const streamLength = new TextEncoder().encode(stream).length;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
