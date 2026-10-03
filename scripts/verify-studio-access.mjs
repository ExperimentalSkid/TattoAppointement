import assert from "node:assert/strict";
import { getStudioOwnerEmail, isAllowedGoogleIdentity, isAllowedStudioEmail, isGoogleSignInConfigured } from "../src/lib/studio-access.ts";
const keys = ["NODE_ENV", "STUDIO_OWNER_EMAIL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
try {
  process.env.NODE_ENV = "production";
  delete process.env.STUDIO_OWNER_EMAIL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal(getStudioOwnerEmail(), null);
  assert.equal(isAllowedStudioEmail("artist@example.com"), true);
  assert.equal(isAllowedStudioEmail("  ARTIST@example.com  "), true);
  for (const invalid of [null, undefined, 123, "", " ", "invalid", "artist@", "@example.com", "artist@example.com other@example.com"]) {
    assert.equal(isAllowedStudioEmail(invalid), false);
  }
  assert.equal(isGoogleSignInConfigured(), false);

  const verifiedArtist = { id: "google-subject-artist", email: "artist@example.com", emailVerified: true };
  assert.equal(isAllowedGoogleIdentity(verifiedArtist), false);
  process.env.GOOGLE_CLIENT_ID = "test-client";
  assert.equal(isGoogleSignInConfigured(), false);
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  assert.equal(isGoogleSignInConfigured(), true);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist), true);
  assert.equal(isAllowedGoogleIdentity({ ...verifiedArtist, email: "other@example.com" }), true);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist, "ARTIST@example.com"), true);
  assert.equal(isAllowedGoogleIdentity({ ...verifiedArtist, email: "other@example.com" }, "artist@example.com"), false);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist, null), false);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist, "invalid"), false);
  assert.equal(isAllowedGoogleIdentity(null), false);
  for (const emailVerified of [false, undefined, null, "true", 1]) {
    assert.equal(isAllowedGoogleIdentity({ ...verifiedArtist, emailVerified }), false);
  }
  for (const id of [undefined, null, "", " ", " subject ", 123]) {
    assert.equal(isAllowedGoogleIdentity({ ...verifiedArtist, id }), false);
  }
  assert.equal(isAllowedGoogleIdentity({ ...verifiedArtist, email: "invalid" }), false);

  process.env.STUDIO_OWNER_EMAIL = "  Artist@Example.com  ";
  assert.equal(getStudioOwnerEmail(), "artist@example.com");
  assert.equal(isAllowedStudioEmail("ARTIST@example.com"), true);
  assert.equal(isAllowedStudioEmail("other@example.com"), false);
  assert.equal(isAllowedStudioEmail(null), false);
  assert.equal(isGoogleSignInConfigured(), true);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist), true);
  assert.equal(isAllowedGoogleIdentity({ ...verifiedArtist, email: "other@example.com" }), false);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist, "other@example.com"), false);
  process.env.STUDIO_OWNER_EMAIL = "invalid";
  assert.equal(getStudioOwnerEmail(), null);
  assert.equal(isGoogleSignInConfigured(), true);
  assert.equal(isAllowedStudioEmail("artist@example.com"), false);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist), false);
  process.env.STUDIO_OWNER_EMAIL = " ";
  assert.equal(isAllowedStudioEmail("artist@example.com"), true);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist), true);

  process.env.GOOGLE_CLIENT_ID = " ";
  assert.equal(isGoogleSignInConfigured(), false);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist), false);
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = " ";
  assert.equal(isGoogleSignInConfigured(), false);
  assert.equal(isAllowedGoogleIdentity(verifiedArtist), false);

  process.env.NODE_ENV = "development";
  assert.equal(isAllowedStudioEmail("artist@example.com"), true);
} finally {
  for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
}
console.log("Single-owner and verified Google identity checks passed.");
