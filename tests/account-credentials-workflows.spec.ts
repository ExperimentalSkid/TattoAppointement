import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test as base } from "./fixtures";

// Isolate the worker's auth singleton/JWKS cache from google-bootstrap.spec.ts.
// Only external Google and email transports are mocked. Sessions, credentials,
// verification tokens and browser Server Actions use the real app/database.
const test = base.extend<object, { credentialsWorker: string }>({
  credentialsWorker: [async ({ browserName }, use) => { await use(browserName); }, { scope: "worker", auto: true }],
});
const origin = "http://127.0.0.1:3000";
const clientId = "tinta-credentials-integration.apps.googleusercontent.com";
const password = "Credentials-Workflow-2026!";
const googleArtist = { sub: "credentials-google-artist", email: "credentials-google@example.com" };
const environmentKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STUDIO_OWNER_EMAIL", "BETTER_AUTH_URL", "RESEND_API_KEY", "EMAIL_FROM"] as const;
const previousEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "credentials-integration-key", alg: "RS256", use: "sig" };
const codes = new Set<string>();
let auth: typeof import("../src/lib/auth").auth;
let prisma: typeof import("../src/lib/prisma").prisma;
let originalFetch: typeof fetch;
let requestNumber = 0;
let resetMessage: { to: string[]; text: string } | null = null;

function idToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode({ iss: "https://accounts.google.com", aud: clientId, ...googleArtist, email_verified: true, name: "Fresh Google artist", iat: now, exp: now + 300 })}`;
  return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
}

function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
}

async function handler(path: string, data?: Record<string, unknown>, cookie = "") {
  return auth.handler(new Request(`${origin}/api/auth${path}`, {
    method: data ? "POST" : "GET", headers: { origin, "content-type": "application/json", cookie, "x-forwarded-for": `10.81.0.${++requestNumber}` },
    body: data ? JSON.stringify(data) : undefined,
  }));
}

async function googleSession(context: BrowserContext) {
  const start = await handler("/sign-in/social", { provider: "google", callbackURL: `${origin}/calendar`, disableRedirect: true });
  expect(start.status).toBe(200);
  const authorize = new URL((await start.json()).url);
  expect(authorize.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
  const code = randomUUID();
  codes.add(code);
  const callback = await handler(`/callback/google?${new URLSearchParams({ code, state: authorize.searchParams.get("state") ?? "" })}`, undefined, cookieHeader(start));
  expect(callback.headers.get("location")).toBe(`${origin}/calendar`);
  // Import the exact cookie issued by the real completed OAuth handler. No
  // session tokens or cookie signatures are constructed by this test.
  const issued = callback.headers.getSetCookie().find(value => value.split("=", 1)[0].endsWith(".session_token"));
  expect(issued).toBeDefined();
  const pair = issued!.split(";", 1)[0];
  const separator = pair.indexOf("=");
  await context.addCookies([{ name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin, httpOnly: true, sameSite: "Lax" }]);
  const session = await context.request.get("/api/auth/get-session");
  expect(session.status()).toBe(200);
  return (await session.json()).user.id as string;
}

async function useEnglish(page: Page) {
  expect((await page.request.post("/api/preferences/language", { headers: { origin }, data: { language: "en" } })).status()).toBe(200);
}

test.beforeAll(async () => {
  Object.assign(process.env, { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: "credentials-local-placeholder", STUDIO_OWNER_EMAIL: "", BETTER_AUTH_URL: origin, RESEND_API_KEY: "credentials-mock-mail", EMAIL_FROM: "Tinta QA <qa@example.com>" });
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    const body = input instanceof Request ? await input.text() : String(init?.body ?? "");
    if (url.href === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(body);
      expect(params.get("client_id")).toBe(clientId);
      expect(params.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
      expect(params.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);
      expect(codes.delete(params.get("code") ?? "")).toBe(true);
      return Response.json({ token_type: "Bearer", expires_in: 300, access_token: "credentials-local-token", id_token: idToken(), scope: "openid email profile" });
    }
    if (url.href === "https://api.resend.com/emails") {
      resetMessage = JSON.parse(body);
      return Response.json({ id: "credentials-mock-delivery" });
    }
    throw new Error(`Unexpected credentials test transport: ${url.origin}${url.pathname}`);
  };
  ({ auth } = await import("../src/lib/auth"));
  ({ prisma } = await import("../src/lib/prisma"));
});

test.afterAll(async () => {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys) {
    const value = previousEnvironment.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await prisma?.$disconnect();
});

test("a fresh Google artist creates an email password for the same workspace, revokes peers and clears saved password fields", async ({ page, browser }) => {
  const artistId = await googleSession(page.context());
  await useEnglish(page);
  await page.goto("/settings");
  await expect(page.locator("#current-password")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create password", exact: true })).toBeVisible();
  await page.locator("#studio-name").fill("Google credentials atelier");
  await page.locator(".studio-settings-form button[type='submit']").click();
  await expect(page.locator(".studio-settings-form .settings-success")).toBeVisible();
  const peer = await browser.newContext({ baseURL: origin });
  try {
    expect(await googleSession(peer)).toBe(artistId);
    await page.locator("#new-password").fill(password);
    await page.locator("#confirm-password").fill(password);
    await page.locator(".password-settings-form button[type='submit']").click();
    await expect(page.locator(".password-settings-form [role='status']")).toContainText("Password changed");
    const savedPasswordFieldsCleared = await page.locator(".password-settings-form input[type='password']").evaluateAll(fields => fields.every(field => !(field as HTMLInputElement).value));
    await expect(page.locator("#current-password")).toBeVisible();
    expect(await (await peer.request.get("/api/auth/get-session")).json()).toBeNull();
    expect((await peer.request.get("/api/account/export")).status()).toBe(401);
    await page.locator(".signout-button:visible").first().click();
    await page.waitForURL(/\/sign-in$/);
    await page.locator("#email").fill(googleArtist.email);
    await page.locator("#password").fill(password);
    await page.locator(".auth-form button[type='submit']").click();
    await page.waitForURL(url => url.pathname === "/calendar");
    const exported = await (await page.request.get("/api/account/export")).json();
    expect(exported.profile).toMatchObject({ id: artistId, email: googleArtist.email, studioName: "Google credentials atelier" });
    expect(await prisma.account.count({ where: { userId: artistId } })).toBe(2);
    expect(savedPasswordFieldsCleared, "Successful password saves must clear private fields so sync no longer sees an unsaved draft.").toBe(true);
  } finally { await peer.close(); }
});

test("a real generated recovery link changes the password, revokes old sessions and cannot be reused", async ({ page }) => {
  const email = "credentials-recovery@example.com";
  const changed = "Recovered-Credentials-2026!";
  const signup = await page.request.post("/api/auth/sign-up/email", { headers: { origin }, data: { name: "Recovery artist", email, password } });
  expect(signup.status()).toBe(200);
  const artistId = (await signup.json()).user.id;
  await useEnglish(page);
  resetMessage = null;
  const request = await handler("/request-password-reset", { email, redirectTo: `${origin}/reset-password` });
  expect(request.status).toBe(200);
  await expect.poll(() => resetMessage?.to[0]).toBe(email);
  const emailedUrl = resetMessage!.text.split("\n").find(line => line.startsWith(`${origin}/api/auth/reset-password/`));
  expect(emailedUrl).toBeDefined();
  await page.goto(emailedUrl!);
  const singleUseUrl = page.url();
  expect(new URL(singleUseUrl).searchParams.get("token")).toBeTruthy();
  await page.locator("#recovery-password").fill(changed);
  await page.locator("#recovery-confirm").fill(changed);
  await page.locator(".auth-form button[type='submit']").click();
  await expect(page.locator(".auth-card [role='status']")).toContainText("Your password has changed");
  await expect(page).toHaveURL(`${origin}/reset-password`);
  expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
  expect((await page.request.post("/api/auth/sign-in/email", { headers: { origin }, data: { email, password } })).status()).toBe(401);
  const reopened = await page.request.post("/api/auth/sign-in/email", { headers: { origin }, data: { email, password: changed } });
  expect(reopened.status()).toBe(200);
  expect((await reopened.json()).user.id).toBe(artistId);
  await page.goto(singleUseUrl);
  await page.locator("#recovery-password").fill("Reuse-Must-Fail-2026!");
  await page.locator("#recovery-confirm").fill("Reuse-Must-Fail-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await expect(page.locator(".auth-card [role='alert']")).toContainText("invalid or has expired");
  expect((await page.request.post("/api/auth/sign-in/email", { headers: { origin }, data: { email, password: changed } })).status()).toBe(200);
});
