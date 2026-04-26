import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

type SendTaxReceiptEmailArgs = {
  to: string;
  recipientName: string;
  startDate: string;
  endDate: string;
  pdf: Buffer;
  filename: string;
};

function asBool(value: string | undefined, fallback: boolean) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(text);
}

function readResponse(
  socket: net.Socket | tls.TLSSocket,
  state: { buffer: string },
  expectedCodes: string[],
) {
  return new Promise<string>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      state.buffer += chunk.toString("utf8");
      if (!state.buffer.includes("\r\n")) return;

      const lines = state.buffer.split("\r\n");
      state.buffer = lines.pop() ?? "";
      const complete = lines.filter(Boolean);
      if (!complete.length) return;

      const last = complete[complete.length - 1];
      const code = last.slice(0, 3);
      const done = last.length >= 4 && last[3] === " ";
      if (!done) return;

      socket.off("data", onData);
      socket.off("error", onError);

      if (!expectedCodes.includes(code)) {
        reject(
          new Error(
            `SMTP unexpected response ${code}. Full response: ${complete.join(" | ")}`,
          ),
        );
        return;
      }
      resolve(complete.join("\n"));
    };

    const onError = (err: Error) => {
      socket.off("data", onData);
      socket.off("error", onError);
      reject(err);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function smtpCommand(
  socket: net.Socket | tls.TLSSocket,
  state: { buffer: string },
  command: string,
  expectedCodes: string[],
) {
  socket.write(`${command}\r\n`);
  return readResponse(socket, state, expectedCodes);
}

function chunkBase64(value: string, chunkSize = 76) {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks.join("\r\n");
}

export async function sendTaxReceiptEmail({
  to,
  recipientName,
  startDate,
  endDate,
  pdf,
  filename,
}: SendTaxReceiptEmailArgs) {
  const smtpHost = String(process.env.SMTP_HOST ?? "").trim();
  const smtpPort = Number(process.env.SMTP_PORT ?? 465);
  const smtpUser = String(process.env.SMTP_USER ?? "").trim();
  const smtpPass = String(process.env.SMTP_PASS ?? "").trim();
  const smtpSecure = asBool(process.env.SMTP_SECURE, true);
  const fromEmail = String(
    process.env.CONTRIBUTIONS_EMAIL_FROM ?? process.env.FOT_EMAIL_FROM ?? "",
  ).trim();

  if (!smtpHost) throw new Error("Missing SMTP_HOST");
  if (!Number.isFinite(smtpPort) || smtpPort <= 0) throw new Error("Invalid SMTP_PORT");
  if (!smtpUser) throw new Error("Missing SMTP_USER");
  if (!smtpPass) throw new Error("Missing SMTP_PASS");
  if (!fromEmail) throw new Error("Missing CONTRIBUTIONS_EMAIL_FROM (or FOT_EMAIL_FROM)");

  const toEmail = String(to ?? "").trim();
  if (!toEmail) throw new Error("Missing destination email");

  const subject = `COG-PKG Tax Receipt (${startDate} to ${endDate})`;
  const safeName = String(recipientName ?? "").trim() || "Member";
  const html = [
    `<p>Dear ${safeName},</p>`,
    `<p>Please find your tax receipt attached for the period ${startDate} to ${endDate}.</p>`,
    "<p>Sincerely,<br/>COG-PKG Team</p>",
  ].join("");

  const fromAddress = fromEmail.includes("<")
    ? fromEmail.slice(fromEmail.indexOf("<") + 1, fromEmail.indexOf(">")).trim()
    : fromEmail;
  const boundary = `emc-tax-receipt-${randomUUID()}`;
  const attachmentBase64 = chunkBase64(pdf.toString("base64"));

  const mimeBody = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Message-ID: <${randomUUID()}@emc.local>`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    attachmentBase64,
    "",
    `--${boundary}--`,
    ".",
    "",
  ].join("\r\n");

  const socket = smtpSecure
    ? tls.connect({ host: smtpHost, port: smtpPort, servername: smtpHost })
    : net.connect({ host: smtpHost, port: smtpPort });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", (err) => reject(err));
  });

  const state = { buffer: "" };
  try {
    await readResponse(socket, state, ["220"]);
    await smtpCommand(socket, state, "EHLO emc.local", ["250"]);
    await smtpCommand(socket, state, "AUTH LOGIN", ["334"]);
    await smtpCommand(socket, state, Buffer.from(smtpUser).toString("base64"), ["334"]);
    await smtpCommand(socket, state, Buffer.from(smtpPass).toString("base64"), ["235"]);
    await smtpCommand(socket, state, `MAIL FROM:<${fromAddress}>`, ["250"]);
    await smtpCommand(socket, state, `RCPT TO:<${toEmail}>`, ["250", "251"]);
    await smtpCommand(socket, state, "DATA", ["354"]);
    socket.write(mimeBody);
    await readResponse(socket, state, ["250"]);
    await smtpCommand(socket, state, "QUIT", ["221"]);
  } finally {
    socket.destroy();
  }
}
