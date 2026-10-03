import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { expect, test } from "./fixtures";

// These tests exercise the application's real Better Auth handler and database
// hooks. Only Google's remote token/JWKS transport is replaced locally. They do
// not represent a real Google consent-screen or production OAuth verification.
const origin = "http://127.0.0.1:3000";
const clientId = "tinta-local-integration.apps.googleusercontent.com";
const environmentKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STUDIO_OWNER_EMAIL", "BETTER_AUTH_URL"] as const;
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyId = "tinta-local-integration-key";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, alg: "RS256", use: "sig" };
type Identity = { subject: string; email: string; verified?: boolean };
const identities = new Map<string, Identity>();
let auth: typeof import("../src/lib/auth").auth;
let prisma: typeof import("../src/lib/prisma").prisma;
let originalFetch: typeof globalThis.fetch;
let tokenRequests = 0;
let jwksRequests = 0;

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
      "x-forwarded-for": "10.61.0.1",
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

  const second = await googleFlow(identity);
  expect(second.headers.get("location")).toBe(`${origin}/calendar`);
  const session = await request("/get-session", undefined, cookiesFrom(second));
  expect((await session.json()).user.id).toBe(owner.id);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.account.count({ where: { providerId: "google", userId: owner.id } })).toBe(1);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).studioName).toBe("Existing tattoo studio");
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
