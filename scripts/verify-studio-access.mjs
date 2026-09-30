import assert from "node:assert/strict";
import { getStudioOwnerEmail, isAllowedGoogleIdentity, isAllowedStudioEmail, isGoogleSignInConfigured } from "../src/lib/studio-access.ts";
const keys = ["NODE_ENV", "STUDIO_OWNER_EMAIL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
try {
  process.env.NODE_ENV = "production";
  delete process.env.STUDIO_OWNER_EMAIL;
  assert.equal(isAllowedStudioEmail("artist@example.com"), false);
  assert.equal(isGoogleSignInConfigured(), false);
  process.env.STUDIO_OWNER_EMAIL = "  Artist@Example.com  ";
  assert.equal(getStudioOwnerEmail(), "artist@example.com");
  assert.equal(isAllowedStudioEmail("ARTIST@example.com"), true);
  assert.equal(isAllowedStudioEmail("other@example.com"), false);
  assert.equal(isAllowedStudioEmail(null), false);
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  assert.equal(isGoogleSignInConfigured(), true);
  assert.equal(isAllowedGoogleIdentity({ email: "artist@example.com", emailVerified: true }), true);
  assert.equal(isAllowedGoogleIdentity({ email: "artist@example.com", emailVerified: false }), false);
  assert.equal(isAllowedGoogleIdentity({ email: "other@example.com", emailVerified: true }), false);
  assert.equal(isAllowedGoogleIdentity({ email: "artist@example.com", emailVerified: "true" }), false);
  process.env.STUDIO_OWNER_EMAIL = "invalid";
  assert.equal(isGoogleSignInConfigured(), false);
  assert.equal(isAllowedStudioEmail("artist@example.com"), false);
  delete process.env.STUDIO_OWNER_EMAIL;
  process.env.NODE_ENV = "development";
  assert.equal(isAllowedStudioEmail("artist@example.com"), true);
} finally {
  for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
}
console.log("Single-owner and verified Google identity checks passed.");
