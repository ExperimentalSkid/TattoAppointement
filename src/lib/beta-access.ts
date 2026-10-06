/** Server configuration controls membership; names and email never grant it. */
export function invitationsRequired() {
  return process.env.REQUIRE_INVITATION === "true";
}

export function getTintaAdminUserId() {
  const value = process.env.TINTA_ADMIN_USER_ID;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

export type BetaIdentity = {
  id: string;
  emailVerified: boolean;
  activatedAt: Date | string | null;
  deactivatedAt?: Date | string | null;
  deletionRequestedAt?: Date | string | null;
};

export function isTintaAdminIdentity(identity: BetaIdentity | null | undefined) {
  const adminId = getTintaAdminUserId();
  return Boolean(adminId && identity?.id === adminId && identity.emailVerified === true
    && identity.activatedAt && !identity.deactivatedAt && !identity.deletionRequestedAt);
}

export function isArtistAccessId(input: unknown): input is string {
  return typeof input === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(input);
}

/** Exact instructions include the last observed pause timestamp for concurrency. */
export function parseArtistAccessChange(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || typeof data.enabled !== "boolean") return null;
  const timestamp = data.expectedDeactivatedAt;
  if (timestamp !== null && (typeof timestamp !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp)) return null;
  return { enabled: data.enabled, expectedDeactivatedAt: timestamp as string | null };
}
