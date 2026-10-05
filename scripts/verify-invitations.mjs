import assert from "node:assert/strict";
import { invitationsRequired, getTintaAdminUserId, isTintaAdminIdentity } from "../src/lib/beta-access.ts";
import { createInvitationCode, hashInvitationCode, normalizeInvitationCode, parseInvitationCreation,
  parseInvitationRedemption, isInvitationId, invitationAttemptState, INVITATION_ATTEMPT_WINDOW_MS } from "../src/lib/invitation-code.ts";

const original = { REQUIRE_INVITATION: process.env.REQUIRE_INVITATION, TINTA_ADMIN_USER_ID: process.env.TINTA_ADMIN_USER_ID };
try {
  delete process.env.REQUIRE_INVITATION;
  assert.equal(invitationsRequired(), false);
  process.env.REQUIRE_INVITATION = "true";
  assert.equal(invitationsRequired(), true);
  process.env.REQUIRE_INVITATION = "TRUE";
  assert.equal(invitationsRequired(), false);

  const admin = { id: "verified-admin-id", emailVerified: true, activatedAt: new Date(), deletionRequestedAt: null };
  delete process.env.TINTA_ADMIN_USER_ID;
  assert.equal(isTintaAdminIdentity(admin), false, "An unset admin identity fails closed");
  process.env.TINTA_ADMIN_USER_ID = admin.id;
  assert.equal(getTintaAdminUserId(), admin.id);
  assert.equal(isTintaAdminIdentity(admin), true);
  assert.equal(isTintaAdminIdentity({ ...admin, id: "other-id", name: "Kim", email: "kim@example.com" }), false);
  assert.equal(isTintaAdminIdentity({ ...admin, emailVerified: false }), false);
  assert.equal(isTintaAdminIdentity({ ...admin, activatedAt: null }), false);
  assert.equal(isTintaAdminIdentity({ ...admin, deletionRequestedAt: new Date() }), false);
  for (const invalid of [" verified-admin-id", "verified-admin-id ", "id@example.com", "", "a".repeat(129)]) {
    process.env.TINTA_ADMIN_USER_ID = invalid;
    assert.equal(getTintaAdminUserId(), null);
    assert.equal(isTintaAdminIdentity(admin), false);
  }

  const code = createInvitationCode();
  assert.match(code, /^TINTA-[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}(?:-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{5}){3}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
  const normalized = normalizeInvitationCode(code);
  assert.equal(normalized.length, 26);
  assert.equal(normalizeInvitationCode(code.toLowerCase()), normalized);
  assert.equal(normalizeInvitationCode(`  ${code.replaceAll("-", " ")}  `), normalized);
  assert.equal(normalizeInvitationCode(normalized), normalized);
  assert.equal(hashInvitationCode(normalized), hashInvitationCode(code));
  assert.match(hashInvitationCode(code), /^[0-9a-f]{64}$/);
  for (const invalid of [null, undefined, 123, "", code + "?", code + "/", code.replace("TINTA", "OTHER"), "8" + normalized.slice(1), "a".repeat(129), "I".repeat(26)]) {
    assert.equal(normalizeInvitationCode(invalid), null);
    assert.equal(hashInvitationCode(invalid), null);
  }

  assert.deepEqual(parseInvitationCreation({}), { expiresInDays: 7 });
  for (const days of [1, 7, 30]) assert.deepEqual(parseInvitationCreation({ expiresInDays: days }), { expiresInDays: days });
  for (const invalid of [null, [], "", { expiresInDays: null }, { expiresInDays: 0 }, { expiresInDays: 31 }, { expiresInDays: 1.5 }, { expiresInDays: "7" }, { expiresInDays: 7, email: "private@example.com" }]) {
    assert.equal(parseInvitationCreation(invalid), null);
  }
  assert.deepEqual(parseInvitationRedemption({ code }), { code });
  assert.deepEqual(parseInvitationRedemption({ code: "invalid" }), { code: "invalid" }, "Bounded malformed codes count as attempts");
  for (const invalid of [null, [], {}, { code: 1 }, { code: "a".repeat(129) }, { code, userId: "other" }]) assert.equal(parseInvitationRedemption(invalid), null);
  assert.equal(isInvitationId("cmg00000000000000000000000"), true);
  for (const invalid of ["", "a".repeat(41), "../private", "cmg0000000000000000000000/", 123]) assert.equal(isInvitationId(invalid), false);

  const start = new Date("2026-01-01T12:00:00Z");
  let window = null;
  for (let count = 1; count <= 5; count++) {
    const attempt = invitationAttemptState(window, start);
    assert.equal(attempt.allowed, true);
    assert.equal(attempt.attempts, count);
    window = { windowStartedAt: attempt.windowStartedAt, attempts: attempt.attempts };
  }
  assert.deepEqual(invitationAttemptState(window, start), { allowed: false, retryAfterSeconds: 900 });
  assert.deepEqual(invitationAttemptState(window, new Date(start.getTime() + INVITATION_ATTEMPT_WINDOW_MS - 1)), { allowed: false, retryAfterSeconds: 1 });
  const reset = new Date(start.getTime() + INVITATION_ATTEMPT_WINDOW_MS);
  assert.deepEqual(invitationAttemptState(window, reset), { allowed: true, windowStartedAt: reset, attempts: 1 });
  assert.equal(invitationAttemptState(window, new Date(start.getTime() - 1)).allowed, false, "Clock rollback does not reopen an exhausted window");
} finally {
  for (const [key, value] of Object.entries(original)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
console.log("Invitation normalization, identity authorization and account-level attempt limits passed.");
