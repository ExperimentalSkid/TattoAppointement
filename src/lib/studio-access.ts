export const STUDIO_OWNER_SLOT = "studio-owner";

export function getStudioOwnerEmail() {
  const value = process.env.STUDIO_OWNER_EMAIL?.trim().toLowerCase();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function isAllowedStudioEmail(email: unknown) {
  if (typeof email !== "string") return false;
  const configured = getStudioOwnerEmail();
  if (configured) return email.trim().toLowerCase() === configured;
  return process.env.NODE_ENV !== "production";
}

export function isGoogleSignInConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && getStudioOwnerEmail());
}

export function isAllowedGoogleIdentity(user: { email?: unknown; emailVerified?: unknown } | null | undefined) {
  return Boolean(user && isGoogleSignInConfigured() && user.emailVerified === true && isAllowedStudioEmail(user.email));
}
