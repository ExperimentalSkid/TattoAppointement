import { createHash, randomBytes } from "node:crypto";

// Crockford's alphabet omits letters easily confused with digits. Encoding all
// sixteen random bytes provides 128 bits; formatting never adds entropy.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITATION_ATTEMPT_LIMIT = 5;
export const INVITATION_ATTEMPT_WINDOW_MS = 15 * 60_000;

export function normalizeInvitationCode(input: unknown) {
  if (typeof input !== "string" || input.length > 128) return null;
  const value = input.toUpperCase().replace(/[\s-]/g, "").replace(/^TINTA/, "");
  return /^[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}$/.test(value) ? value : null;
}

export function hashInvitationCode(input: unknown) {
  const normalized = normalizeInvitationCode(input);
  return normalized ? createHash("sha256").update(normalized, "ascii").digest("hex") : null;
}

export function createInvitationCode() {
  let number = BigInt(`0x${randomBytes(16).toString("hex")}`);
  let encoded = "";
  for (let index = 0; index < 26; index++) {
    encoded = ALPHABET[Number(number & 31n)] + encoded;
    number >>= 5n;
  }
  return `TINTA-${[encoded.slice(0, 5), encoded.slice(5, 10), encoded.slice(10, 15), encoded.slice(15, 20), encoded.slice(20)].join("-")}`;
}

export function parseInvitationCreation(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => key !== "expiresInDays")) return null;
  const expiresInDays = data.expiresInDays === undefined ? 7 : data.expiresInDays;
  return typeof expiresInDays === "number" && Number.isInteger(expiresInDays) && expiresInDays >= 1 && expiresInDays <= 30
    ? { expiresInDays } : null;
}

export function parseInvitationRedemption(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  // A malformed but bounded code still consumes one account-level attempt.
  return Object.keys(data).length === 1 && typeof data.code === "string" && data.code.length <= 128
    ? { code: data.code } : null;
}

export function isInvitationId(input: unknown): input is string {
  return typeof input === "string" && /^[a-z0-9]{20,40}$/.test(input);
}

export function invitationAttemptState(window: { windowStartedAt: Date; attempts: number } | null, now: Date) {
  const age = window ? now.getTime() - window.windowStartedAt.getTime() : INVITATION_ATTEMPT_WINDOW_MS;
  if (!window || age >= INVITATION_ATTEMPT_WINDOW_MS) {
    return { allowed: true as const, windowStartedAt: now, attempts: 1 };
  }
  if (window.attempts >= INVITATION_ATTEMPT_LIMIT) {
    return { allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((window.windowStartedAt.getTime() + INVITATION_ATTEMPT_WINDOW_MS - now.getTime()) / 1000)) };
  }
  return { allowed: true as const, windowStartedAt: window.windowStartedAt, attempts: window.attempts + 1 };
}
