export const STUDIO_OWNER_SLOT = "studio-owner";

function normalizeEmail(email: unknown) {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function getStudioOwnerEmail() {
  return normalizeEmail(process.env.STUDIO_OWNER_EMAIL);
}

export function isAllowedStudioEmail(email: unknown) {
  const candidate = normalizeEmail(email);
  if (!candidate) return false;
  // A supplied restriction must be valid; an invalid address cannot open setup.
  if (process.env.STUDIO_OWNER_EMAIL?.trim()) return candidate === getStudioOwnerEmail();
  return true;
}

export function isGoogleSignInConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function isAllowedGoogleIdentity(user: { id?: unknown; email?: unknown; emailVerified?: unknown } | null | undefined, ownerEmail?: unknown) {
  if (!user || !isGoogleSignInConfigured() || user.emailVerified !== true || !isAllowedStudioEmail(user.email)) return false;
  if (typeof user.id !== "string" || !user.id || user.id.trim() !== user.id) return false;
  return ownerEmail === undefined || normalizeEmail(user.email) === normalizeEmail(ownerEmail);
}
