import { createHash, randomBytes } from "crypto";

export function hashFotToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createFotToken() {
  return randomBytes(24).toString("base64url");
}

export function resolveFotTokenHash(token: string) {
  const normalized = String(token ?? "").trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }
  return hashFotToken(normalized);
}
