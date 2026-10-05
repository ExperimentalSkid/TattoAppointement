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
  deletionRequestedAt?: Date | string | null;
};

export function isTintaAdminIdentity(identity: BetaIdentity | null | undefined) {
  const adminId = getTintaAdminUserId();
  return Boolean(adminId && identity?.id === adminId && identity.emailVerified === true
    && identity.activatedAt && !identity.deletionRequestedAt);
}
