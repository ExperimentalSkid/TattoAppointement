import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { expect, test } from "./fixtures";

// These tests exercise the application's real Better Auth handler and database
// hooks. Only Google's remote token/JWKS transport is replaced locally. They do
// not represent a real Google consent-screen or production OAuth verification.
const origin = "http://127.0.0.1:3000";
const clientId = "tinta-local-integration.apps.googleusercontent.com";
const environmentKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STUDIO_OWNER_EMAIL", "BETTER_AUTH_URL", "REQUIRE_INVITATION", "TINTA_ADMIN_USER_ID"] as const;
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyId = "tinta-local-integration-key";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, alg: "RS256", use: "sig" };
type Identity = { subject: string; email: string; verified?: boolean };
const identities = new Map<string, Identity>();
let auth: typeof import("../src/lib/auth").auth;
let prisma: typeof import("../src/lib/prisma").prisma;
let invitations: typeof import("../src/lib/invitations");
let originalFetch: typeof globalThis.fetch;
let tokenRequests = 0;
let jwksRequests = 0;
let requestNumber = 0;

function testIdToken(identity: Identity) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: clientId, sub: identity.subject,
    email: identity.email, email_verified: identity.verified ?? true,
    name: "Local integration artist", iat: now, exp: now + 300,
  })).toString("base64url");
  const payload = `${header}.${claims}`;
  return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
}

function cookiesFrom(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function request(path: string, data?: Record<string, unknown>, cookies = "") {
  return auth.handler(new Request(`${origin}/api/auth${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      origin, "content-type": "application/json", cookie: cookies,
      "x-forwarded-for": `10.61.${Math.floor(++requestNumber / 250)}.${requestNumber % 250 + 1}`,
    },
    body: data ? JSON.stringify(data) : undefined,
  }));
}

async function googleFlow(identity: Identity, sessionCookies = "", link = false) {
  const start = await request(link ? "/link-social" : "/sign-in/social", {
    provider: "google", callbackURL: `${origin}${link ? "/settings" : "/calendar"}`,
    errorCallbackURL: `${origin}/sign-in?error=oauth`, disableRedirect: true,
  }, sessionCookies);
  expect(start.status).toBe(200);
  const authorize = new URL((await start.json()).url);
  expect(authorize.origin).toBe("https://accounts.google.com");
  expect(authorize.searchParams.get("client_id")).toBe(clientId);
  expect(authorize.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  const code = randomUUID();
  identities.set(code, identity);
  const query = new URLSearchParams({ code, state: authorize.searchParams.get("state") ?? "" });
  return request(`/callback/google?${query}`, undefined, [sessionCookies, cookiesFrom(start)].filter(Boolean).join("; "));
}

test.beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = clientId;
  process.env.GOOGLE_CLIENT_SECRET = "local-integration-placeholder";
  process.env.STUDIO_OWNER_EMAIL = "";
  process.env.BETTER_AUTH_URL = origin;
  // Existing cases cover unrestricted account creation; individual invite
  // cases change only this worker's server configuration and restore it.
  process.env.REQUIRE_INVITATION = "false";
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
      jwksRequests += 1;
      return Response.json({ keys: [jwk] });
    }
    if (url.href === "https://oauth2.googleapis.com/token") {
      tokenRequests += 1;
      const body = new URLSearchParams(input instanceof Request ? await input.text() : String(init?.body ?? ""));
      expect(body.get("client_id")).toBe(clientId);
      expect(body.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
      expect(body.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
      const identity = identities.get(body.get("code") ?? "");
      expect(identity).toBeDefined();
      return Response.json({
        token_type: "Bearer", expires_in: 300, access_token: "local-integration-access-token",
        id_token: testIdToken(identity!), scope: "openid email profile",
      });
    }
    throw new Error(`Unexpected network transport in local Google integration: ${url.origin}${url.pathname}`);
  };
  ({ auth } = await import("../src/lib/auth"));
  ({ prisma } = await import("../src/lib/prisma"));
  invitations = await import("../src/lib/invitations");
});

test.afterAll(async () => {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys) {
    const value = savedEnvironment.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await prisma?.$disconnect();
});

test("an unverified Google email leaves artist setup available", async () => {
  const response = await googleFlow({ subject: "local-unverified-artist", email: "unverified@example.com", verified: false });
  expect(response.headers.get("location")).toContain("/sign-in?error=oauth");
  expect(await prisma.user.count()).toBe(0);
  expect(await prisma.account.count()).toBe(0);
  expect(await prisma.session.count()).toBe(0);
});

test("each verified Google artist gets a separate workspace and reopens their saved records", async () => {
  const identity = { subject: "local-google-artist-one", email: "artist-one@example.com" };
  const first = await googleFlow(identity);
  expect(first.headers.get("location")).toBe(`${origin}/calendar`);
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: identity.email } });
  expect(owner.email).toBe(identity.email);
  expect(owner.emailVerified).toBe(true);
  await prisma.user.update({ where: { id: owner.id }, data: { studioName: "Existing tattoo studio" } });
  const client = await prisma.client.create({ data: { artistId: owner.id, name: "Existing client", phone: "+34600000001" } });
  const savedProfile = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const savedRevision = await prisma.workspaceRevision.findUniqueOrThrow({ where: { artistId: owner.id } });

  const second = await googleFlow(identity);
  expect(second.headers.get("location")).toBe(`${origin}/calendar`);
  const session = await request("/get-session", undefined, cookiesFrom(second));
  expect((await session.json()).user.id).toBe(owner.id);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.account.count({ where: { providerId: "google", userId: owner.id } })).toBe(1);
  const reopenedProfile = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  expect(reopenedProfile.studioName).toBe("Existing tattoo studio");
  expect(reopenedProfile.lastSignInAt?.getTime()).toBeGreaterThan(savedProfile.lastSignInAt!.getTime());
  expect(reopenedProfile.updatedAt.getTime()).toBe(savedProfile.updatedAt.getTime());
  expect((await prisma.workspaceRevision.findUniqueOrThrow({ where: { artistId: owner.id } })).revision).toBe(savedRevision.revision);
  expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).artistId).toBe(owner.id);

  const other = await googleFlow({ subject: "local-other-google-artist", email: "other-artist@example.com" });
  expect(other.headers.get("location")).toBe(`${origin}/calendar`);
  const otherSession = await request("/get-session", undefined, cookiesFrom(other));
  const otherArtist = (await otherSession.json()).user;
  expect(otherArtist.id).not.toBe(owner.id);
  expect(otherArtist.email).toBe("other-artist@example.com");
  expect(await prisma.client.count({ where: { artistId: otherArtist.id } })).toBe(0);
  expect(await prisma.user.count()).toBe(2);
  expect(await prisma.account.count()).toBe(2);
  expect(await prisma.workspaceRevision.count()).toBe(2);
  const reopened = await googleFlow(identity);
  expect(reopened.headers.get("location")).toBe(`${origin}/calendar`);
  expect((await (await request("/get-session", undefined, cookiesFrom(reopened))).json()).user.id).toBe(owner.id);
  expect(await prisma.client.count({ where: { artistId: owner.id } })).toBe(1);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).studioName).toBe("Existing tattoo studio");
  expect(tokenRequests).toBeGreaterThanOrEqual(3);
  expect(jwksRequests).toBeGreaterThan(0);
});

test("different Google artists can create independent workspaces simultaneously", async () => {
  const results = await Promise.all([
    googleFlow({ subject: "local-concurrent-google-one", email: "concurrent-one@example.com" }),
    googleFlow({ subject: "local-concurrent-google-two", email: "concurrent-two@example.com" }),
  ]);
  expect(results.filter((response) => response.headers.get("location") === `${origin}/calendar`)).toHaveLength(2);
  expect(await prisma.user.count()).toBe(2);
  expect(await prisma.account.count()).toBe(2);
  expect(await prisma.workspaceRevision.count()).toBe(2);
  expect(await prisma.session.count()).toBe(2);
});

test("simultaneous sign-in with the same Google identity never creates duplicate artist records", async () => {
  const identity = { subject: "local-concurrent-google-same", email: "same-artist@example.com" };
  const results = await Promise.all([googleFlow(identity), googleFlow(identity)]);
  expect(results.some(response => response.headers.get("location") === `${origin}/calendar`)).toBe(true);
  const artist = await prisma.user.findUniqueOrThrow({ where: { email: identity.email } });
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.account.count({ where: { providerId: "google", accountId: identity.subject, userId: artist.id } })).toBe(1);
  expect(await prisma.account.count()).toBe(1);
  expect(await prisma.workspaceRevision.count()).toBe(1);
  const reopened = await googleFlow(identity);
  expect(reopened.headers.get("location")).toBe(`${origin}/calendar`);
  expect((await (await request("/get-session", undefined, cookiesFrom(reopened))).json()).user.id).toBe(artist.id);
});

test("an operator's explicit email restriction still rejects other Google and password artists", async () => {
  process.env.STUDIO_OWNER_EMAIL = "allowed-artist@example.com";
  try {
    const rejected = await googleFlow({ subject: "local-restricted-other", email: "other-artist@example.com" });
    expect(rejected.headers.get("location")).toContain("/sign-in?error=oauth");
    const passwordSignup = await request("/sign-up/email", {
      name: "Restricted artist", email: "other-artist@example.com", password: "LocalArtistAccount-2026!",
    });
    expect(passwordSignup.status).toBe(403);
    expect(await prisma.user.count()).toBe(0);
    const accepted = await googleFlow({ subject: "local-restricted-allowed", email: "allowed-artist@example.com" });
    expect(accepted.headers.get("location")).toBe(`${origin}/calendar`);
    expect(await prisma.user.count()).toBe(1);
  } finally { process.env.STUDIO_OWNER_EMAIL = ""; }
});

test("a password artist explicitly connects same-email Google while retaining existing studio records", async () => {
  const signup = await request("/sign-up/email", {
    name: "Password artist", email: "password-artist@example.com", password: "LocalArtistAccount-2026!",
  });
  expect(signup.status).toBe(200);
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: "password-artist@example.com" } });
  await prisma.user.update({ where: { id: owner.id }, data: { studioName: "Owner chosen studio" } });
  const client = await prisma.client.create({ data: { artistId: owner.id, name: "Existing tattoo client", phone: "+34600000002" } });
  const identity = { subject: "local-password-google-artist", email: owner.email };
  const implicit = await googleFlow(identity);
  expect(implicit.headers.get("location")).toContain("/sign-in?error=oauth");
  expect(await prisma.account.count({ where: { providerId: "google" } })).toBe(0);

  const linked = await googleFlow(identity, cookiesFrom(signup), true);
  expect(linked.headers.get("location")).toBe(`${origin}/settings`);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.account.count({ where: { userId: owner.id } })).toBe(2);
  expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).artistId).toBe(owner.id);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).studioName).toBe("Owner chosen studio");
  const reopened = await googleFlow(identity);
  expect(reopened.headers.get("location")).toBe(`${origin}/calendar`);
  const session = await request("/get-session", undefined, cookiesFrom(reopened));
  expect((await session.json()).user.id).toBe(owner.id);
});

test("invitation gating keeps verified Google identities pending and rejects client activation fields", async () => {
  const previous = { REQUIRE_INVITATION: process.env.REQUIRE_INVITATION, TINTA_ADMIN_USER_ID: process.env.TINTA_ADMIN_USER_ID };
  try {
    const existingIdentity = { subject: "local-invite-existing-google", email: "invite-existing@example.com" };
    await googleFlow(existingIdentity);
    const existing = await prisma.user.findUniqueOrThrow({ where: { email: existingIdentity.email } });
    expect(existing.emailVerified).toBe(true);
    expect(existing.activatedAt).not.toBeNull();
    const client = await prisma.client.create({ data: { artistId: existing.id, name: "Preserved existing client", phone: "+34600000003" } });

    process.env.REQUIRE_INVITATION = "true";
    process.env.TINTA_ADMIN_USER_ID = existing.id;
    const identity = { subject: "local-invite-pending-google", email: "invite-pending@example.com" };
    const first = await googleFlow(identity);
    expect(first.headers.get("location")).toBe(`${origin}/calendar`);
    const pending = await prisma.user.findUniqueOrThrow({ where: { email: identity.email } });
    expect(pending.emailVerified).toBe(true);
    expect(pending.activatedAt).toBeNull();
    expect(pending.lastSignInAt).not.toBeNull();
    const identitySession = await request("/get-session", undefined, cookiesFrom(first));
    expect((await identitySession.json()).user).toMatchObject({ id: pending.id, activatedAt: null });

    const reopened = await Promise.all([googleFlow(identity), googleFlow(identity)]);
    expect(reopened.every(response => response.headers.get("location") === `${origin}/calendar`)).toBe(true);
    expect(await prisma.user.count({ where: { email: identity.email } })).toBe(1);
    expect(await prisma.account.count({ where: { providerId: "google", accountId: identity.subject } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pending.id } })).activatedAt).toBeNull();

    const retained = await googleFlow(existingIdentity);
    expect(retained.headers.get("location")).toBe(`${origin}/calendar`);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).activatedAt?.getTime()).toBe(existing.activatedAt?.getTime());
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).artistId).toBe(existing.id);

    const clientDate = "2099-01-01T00:00:00.000Z";
    for (const field of ["activatedAt", "lastSignInAt"]) {
      const email = `attempt-${field.toLowerCase()}@example.com`;
      const signup = await request("/sign-up/email", { name: "Client field attempt", email,
        password: "LocalArtistAccount-2026!", [field]: clientDate });
      expect(signup.status).toBe(400);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
      const update = await request("/update-user", { [field]: clientDate }, cookiesFrom(first));
      expect(update.status).toBe(400);
    }
    const current = await prisma.user.findUniqueOrThrow({ where: { id: pending.id } });
    expect(current.activatedAt).toBeNull();
    expect(current.lastSignInAt?.getTime()).toBeLessThan(new Date(clientDate).getTime());

    const passwordSignup = await request("/sign-up/email", {
      name: "Pending password artist", email: "invite-password@example.com", password: "LocalArtistAccount-2026!",
      emailVerified: true, role: "ADMIN",
    });
    expect(passwordSignup.status).toBe(200);
    const passwordUser = await prisma.user.findUniqueOrThrow({ where: { email: "invite-password@example.com" } });
    expect(passwordUser.activatedAt).toBeNull();
    expect(passwordUser.emailVerified).toBe(false);
    expect(passwordUser.id).not.toBe(existing.id);
    const updateIdentity = await request("/update-user", { name: "Updated name", emailVerified: true, role: "ADMIN" }, cookiesFrom(passwordSignup));
    expect(updateIdentity.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: passwordUser.id } })).emailVerified).toBe(false);

    const created = await invitations.createInvitation(existing.id, 7, origin);
    const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: created.invitation.id } });
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(created.code);
    expect(Object.hasOwn(stored, "code")).toBe(false);
    expect(Object.hasOwn(stored, "link")).toBe(false);
    expect(created.link).toBe(`${origin}/join#code=${encodeURIComponent(created.code)}`);
    expect(await invitations.redeemInvitation(pending.id, created.code.toLowerCase())).toEqual({ status: "activated" });
    const activated = await prisma.user.findUniqueOrThrow({ where: { id: pending.id } });
    const used = await prisma.invitation.findUniqueOrThrow({ where: { id: stored.id } });
    expect(activated.activatedAt).not.toBeNull();
    expect(used.redeemedById).toBe(pending.id);
    expect(used.redeemedAt?.getTime()).toBe(activated.activatedAt?.getTime());
    expect(await invitations.redeemInvitation(pending.id, created.code)).toEqual({ status: "already_active" });
    const unused = await invitations.createInvitation(existing.id, 7, origin);
    expect(await invitations.redeemInvitation(pending.id, unused.code)).toEqual({ status: "already_active" });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: unused.invitation.id } })).redeemedAt).toBeNull();
    const passwordInvite = await invitations.createInvitation(existing.id, 7, origin);
    expect(await invitations.redeemInvitation(passwordUser.id, passwordInvite.code)).toEqual({ status: "activated" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: passwordUser.id } })).emailVerified).toBe(false);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("one invitation activates at most one concurrent Google identity and expired or revoked codes preserve pending access", async () => {
  const previous = { REQUIRE_INVITATION: process.env.REQUIRE_INVITATION, TINTA_ADMIN_USER_ID: process.env.TINTA_ADMIN_USER_ID };
  try {
    const adminIdentity = { subject: "local-invite-race-admin", email: "invite-race-admin@example.com" };
    await googleFlow(adminIdentity);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminIdentity.email } });
    process.env.TINTA_ADMIN_USER_ID = admin.id;
    process.env.REQUIRE_INVITATION = "true";
    const identities = [
      { subject: "local-invite-race-one", email: "invite-race-one@example.com" },
      { subject: "local-invite-race-two", email: "invite-race-two@example.com" },
    ];
    await Promise.all(identities.map(identity => googleFlow(identity)));
    const users = await Promise.all(identities.map(identity => prisma.user.findUniqueOrThrow({ where: { email: identity.email } })));
    expect(users.every(user => user.emailVerified && user.activatedAt === null)).toBe(true);
    const invite = await invitations.createInvitation(admin.id, 7, origin);
    const results = await Promise.all(users.map(user => invitations.redeemInvitation(user.id, invite.code)));
    expect(results.filter(result => result.status === "activated")).toHaveLength(1);
    expect(results.filter(result => result.status === "unavailable")).toHaveLength(1);
    const winner = users[results.findIndex(result => result.status === "activated")];
    const loser = users[results.findIndex(result => result.status === "unavailable")];
    expect(await prisma.user.count({ where: { id: { in: users.map(user => user.id) }, activatedAt: { not: null } } })).toBe(1);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invite.invitation.id } })).redeemedById).toBe(winner.id);
    expect(await invitations.redeemInvitation(loser.id, invite.code)).toEqual({ status: "unavailable" });

    const expired = await invitations.createInvitation(admin.id, 1, origin);
    await prisma.invitation.update({ where: { id: expired.invitation.id }, data: {
      createdAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000),
    } });
    expect(await invitations.redeemInvitation(loser.id, expired.code)).toEqual({ status: "unavailable" });
    const revoked = await invitations.createInvitation(admin.id, 7, origin);
    expect(await invitations.revokeInvitation(admin.id, revoked.invitation.id)).toEqual({ status: "revoked" });
    expect(await invitations.redeemInvitation(loser.id, revoked.code)).toEqual({ status: "unavailable" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: loser.id } })).activatedAt).toBeNull();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: expired.invitation.id } })).redeemedAt).toBeNull();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: revoked.invitation.id } })).redeemedAt).toBeNull();
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("Google sessions share the database redemption limit and a fifteen-minute reset permits activation", async ({ context }) => {
  const previous = { REQUIRE_INVITATION: process.env.REQUIRE_INVITATION, TINTA_ADMIN_USER_ID: process.env.TINTA_ADMIN_USER_ID };
  try {
    const adminIdentity = { subject: "local-invite-limit-admin", email: "invite-limit-admin@example.com" };
    await googleFlow(adminIdentity);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminIdentity.email } });
    process.env.TINTA_ADMIN_USER_ID = admin.id;
    process.env.REQUIRE_INVITATION = "true";
    const identity = { subject: "local-invite-limit-pending", email: "invite-limit-pending@example.com" };
    const first = await googleFlow(identity);
    // Disabling signup gating later cannot activate an existing pending user.
    process.env.REQUIRE_INVITATION = "false";
    const second = await googleFlow(identity);
    const pending = await prisma.user.findUniqueOrThrow({ where: { email: identity.email } });
    expect(pending.activatedAt).toBeNull();
    const sessions = await Promise.all([first, second].map(async response =>
      (await (await request("/get-session", undefined, cookiesFrom(response))).json())));
    expect(sessions.map(session => session.user.id)).toEqual([pending.id, pending.id]);
    expect(sessions[0].session.id).not.toBe(sessions[1].session.id);
    const sessionCookies = [cookiesFrom(first), cookiesFrom(second)];
    const redeem = (code: string, sessionIndex: number) => context.request.post(`${origin}/api/invitations/redeem`, {
      headers: { origin, cookie: sessionCookies[sessionIndex], "sec-fetch-site": "same-origin" }, data: { code },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await redeem("INVALID-INVITATION", attempt % 2);
      expect(result.status()).toBe(400);
      expect((await result.json()).error).toBe("INVITATION_UNAVAILABLE");
    }
    const blocked = await redeem("INVALID-INVITATION", 1);
    expect(blocked.status()).toBe(429);
    expect((await blocked.json()).error).toBe("INVITATION_RATE_LIMITED");
    expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
    expect((await prisma.invitationAttemptWindow.findUniqueOrThrow({ where: { userId: pending.id } })).attempts).toBe(5);
    await prisma.invitationAttemptWindow.update({ where: { userId: pending.id },
      data: { windowStartedAt: new Date(Date.now() - 15 * 60_000 - 1000) } });
    expect((await redeem("INVALID-INVITATION", 0)).status()).toBe(400);
    expect((await prisma.invitationAttemptWindow.findUniqueOrThrow({ where: { userId: pending.id } })).attempts).toBe(1);
    const invite = await invitations.createInvitation(admin.id, 7, origin);
    const activated = await redeem(invite.code, 1);
    expect(activated.status()).toBe(200);
    expect(await activated.json()).toEqual({ status: "activated" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pending.id } })).activatedAt).not.toBeNull();
    expect(await prisma.invitationAttemptWindow.count({ where: { userId: pending.id } })).toBe(0);
    const available = await context.request.get(`${origin}/api/workspace/sync`, { headers: { cookie: sessionCookies[0] } });
    expect(available.status()).toBe(200);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
