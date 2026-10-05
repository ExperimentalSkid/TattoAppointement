import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the real auth handlers against an isolated memory adapter. Google,
// Next's cookie bridge, browser hooks and diagnostic writes are local fixtures.
// No production files, database, server or network connection is used.
const state = { database: { user: [], account: [], session: [], verification: [] }, google: {}, effects: [], events: [] };
globalThis.tintaPrivacyVerification = state;
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const installed = relative => new URL(`../node_modules/${relative}`, import.meta.url).href;
async function sourceModule(relative, imports = {}, jsx = false) {
  const source = (await readFile(new URL(`../${relative}`, import.meta.url), "utf8"))
    .replace(/^import\s+["'][^"']+\.css["'];?\r?\n/gm, "");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
    ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
  } }).outputText.replace(/from (["'])([^"']+)\1/g, (match, _quote, name) => {
    assert.ok(imports[name], `Unreviewed verification import: ${name}`);
    return `from ${JSON.stringify(imports[name])}`;
  });
  return moduleUrl(compiled);
}
const originalEnv = Object.fromEntries(["NODE_ENV", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STUDIO_OWNER_EMAIL", "DISABLE_SIGN_UP"].map(key => [key, process.env[key]]));
const originalGlobals = Object.fromEntries(["window", "document", "navigator", "MutationObserver", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const origin = "https://privacy-verification.example";
Object.assign(process.env, {
  NODE_ENV: "test", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "privacy-verification-secret-never-used-in-production",
  GOOGLE_CLIENT_ID: "privacy-verification-client", GOOGLE_CLIENT_SECRET: "privacy-verification-google-secret",
  STUDIO_OWNER_EMAIL: "", DISABLE_SIGN_UP: "false",
});
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function installGlobal(name, value) { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
const fixtureModule = moduleUrl(`
  import { memoryAdapter } from ${JSON.stringify(installed("@better-auth/memory-adapter/dist/index.mjs"))};
  const state = globalThis.tintaPrivacyVerification;
  export const prismaAdapter = () => memoryAdapter(state.database);
  export const prisma = { user: { findUnique: async ({ where }) => state.hideNewSignupUser ? null : state.database.user.find(user => user.id === where.id) ?? null } };
  export const nextCookies = () => ({ id: "privacy-verification-next-cookie-bridge" });
  export const isPasswordRecoveryConfigured = () => false;
  export const sendPasswordResetEmail = async () => { throw new Error("Unexpected email delivery"); };
  export const writeDiagnostic = async () => true;
  export const google = () => ({ getUserInfo: async () => ({ user: {
    id: "untrusted-profile-id", email: state.google.email, name: "Mock Google artist",
    emailVerified: state.google.verified !== false, image: "https://private-avatar.example/avatar"
  } }) });
  export const verifyGoogleIdToken = async ({ token }) => token === "mock-valid-google-id-token" ? { sub: state.google.subject } : null;
`);

try {
  installGlobal("fetch", async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, "https://oauth2.googleapis.com/token", "Google is the only mocked external request");
    return Response.json({ access_token: "mock-private-access-token", refresh_token: "mock-private-refresh-token",
      id_token: "mock-valid-google-id-token", expires_in: 3600, token_type: "Bearer", scope: "openid email profile" });
  });
  const accessModule = await sourceModule("src/lib/studio-access.ts");
  const loginPreferenceModule = await sourceModule("src/lib/login-preference.ts");
  const authModule = await sourceModule("src/lib/auth.ts", {
    "@better-auth/prisma-adapter": fixtureModule,
    "better-auth/minimal": installed("better-auth/dist/auth/minimal.mjs"),
    "better-auth/next-js": fixtureModule,
    "better-auth/api": installed("better-auth/dist/api/index.mjs"),
    "better-auth/cookies": installed("better-auth/dist/cookies/index.mjs"),
    "better-auth/social-providers": fixtureModule,
    "@/lib/prisma": fixtureModule, "@/lib/email": fixtureModule,
    "@/lib/studio-access": accessModule, "@/lib/diagnostics": fixtureModule,
    "@/lib/login-preference": loginPreferenceModule,
  });
  const { auth } = await import(authModule);
  function cookies(response) { return response.headers.getSetCookie(); }
  function mergeCookies(jar, response) {
    for (const cookie of cookies(response)) {
      const [pair] = cookie.split(";", 1);
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      if (/;\s*max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
      else jar.set(name, pair.slice(separator + 1));
    }
  }
  async function request(path, body, jar = new Map()) {
    const headers = { Origin: origin, Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") };
    if (body) headers["Content-Type"] = "application/json";
    const response = await auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: body ? "POST" : "GET", headers, ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    mergeCookies(jar, response);
    return response;
  }
  function loginCookies(response, remembered) {
    const issued = cookies(response).filter(cookie => /^(?:__Secure-)?better-auth\.session_token=/.test(cookie));
    const final = issued.at(-1);
    assert.ok(final, "A new login must issue a session cookie"); checks++;
    check(/;\s*Max-Age=2592000(?:;|$)/i.test(final), remembered, "Only the explicit device preference allows persistent login");
    if (!remembered) {
      check(/;\s*(?:Max-Age|Expires)=/i.test(final), false, "Default login cookie has no persistent expiry");
      check(issued.some(cookie => /;\s*Max-Age=2592000(?:;|$)/i.test(cookie)), false, "Initial persistent cookie is removed before response delivery");
    }
    const session = state.database.session.at(-1);
    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    assert.ok(remaining > (remembered ? 29 : 0.9) * 86_400_000 && remaining <= (remembered ? 30 : 1) * 86_400_000,
      "Database session expiry must match the device choice"); checks++;
  }
  const password = "Privacy-Verification-2026!";
  const defaultJar = new Map();
  state.hideNewSignupUser = true;
  let response = await request("/sign-up/email", { name: "Default artist", email: "default@example.com", password }, defaultJar);
  state.hideNewSignupUser = false;
  check(response.status, 200, "Signup remains valid before the new user is visible outside its transaction");
  loginCookies(response, false);
  const defaultSession = state.database.session.at(-1);
  const defaultExpiry = new Date(defaultSession.expiresAt).getTime();
  defaultSession.updatedAt = new Date(Date.now() - 2 * 86_400_000);
  response = await request("/get-session", null, defaultJar);
  check(response.status, 200);
  check(new Date(defaultSession.expiresAt).getTime(), defaultExpiry, "Session-only marker prevents renewal into the persistent duration");
  const persistentJar = new Map([["tinta-remember-login", "1"]]);
  response = await request("/sign-up/email", { name: "Remembered artist", email: "remembered@example.com", password }, persistentJar);
  check(response.status, 200); loginCookies(response, true);
  response = await request("/sign-in/email", { email: "default@example.com", password }, defaultJar);
  check(response.status, 200); loginCookies(response, false);
  defaultJar.set("tinta-remember-login", "1");
  response = await request("/sign-in/email", { email: "default@example.com", password, rememberMe: true }, defaultJar);
  check(response.status, 200); loginCookies(response, true);
  check([...defaultJar.keys()].some(name => name.endsWith(".dont_remember")), false, "Persistence choice clears a previous session-only marker");

  async function googleFlow(jar, link = false) {
    const started = await request(link ? "/link-social" : "/sign-in/social", { provider: "google", callbackURL: `${origin}/calendar` }, jar);
    check(started.status, 200);
    const authorize = new URL((await started.json()).url);
    const callback = `/callback/google?${new URLSearchParams({ code: "mock-google-code", state: authorize.searchParams.get("state") })}`;
    return request(callback, null, jar);
  }
  const oauthFields = ["accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope"];
  for (const remembered of [false, true]) {
    state.google = { email: `${remembered ? "remembered" : "default"}-google@example.com`, subject: `verified-google-subject-${remembered}` };
    const jar = new Map(remembered ? [["tinta-remember-login", "1"]] : []);
    response = await googleFlow(jar);
    check(response.status, 302); check(response.headers.get("location"), `${origin}/calendar`);
    loginCookies(response, remembered);
    const user = state.database.user.find(row => row.email === state.google.email);
    check(user.image, null, "Unused Google profile image is not stored");
    const account = state.database.account.find(row => row.userId === user.id && row.providerId === "google");
    check(account.accountId, state.google.subject, "The verified Google subject remains the provider identity");
    for (const field of oauthFields) check(account[field], null, `Google ${field} is not retained after verification`);
    account.accessToken = "legacy-access-token"; account.refreshToken = "legacy-refresh-token"; account.idToken = "legacy-id-token";
    response = await googleFlow(jar);
    check(response.status, 302); loginCookies(response, remembered);
    for (const field of oauthFields) check(account[field], null, `Repeat sign-in removes obsolete ${field}`);
  }
  const providerInfo = (await auth.$context).options.socialProviders.google.getUserInfo;
  check(await providerInfo({}), null, "Missing Google ID token is rejected");
  state.google.verified = false;
  check(await providerInfo({ idToken: "mock-valid-google-id-token" }), null, "Unverified Google email remains rejected");
  state.google.verified = true; state.google.subject = 123;
  check(await providerInfo({ idToken: "mock-valid-google-id-token" }), null, "Google identity still requires a verified string subject");
  const localUser = state.database.user.find(row => row.email === "default@example.com");
  localUser.emailVerified = true;
  state.google = { email: localUser.email, subject: "verified-linked-google-subject" };
  response = await googleFlow(defaultJar, true);
  check(response.status, 302);
  check(cookies(response).some(cookie => /^(?:__Secure-)?better-auth\.session_token=/.test(cookie)), false, "Connecting Google without a new session does not replace login cookies");
  const sessionsBeforeErasure = state.database.session.length;
  localUser.deletionRequestedAt = new Date();
  response = await request("/sign-in/email", { email: localUser.email, password }, new Map());
  check(response.status, 403, "An account pending erasure cannot create another session");
  check(state.database.session.length, sessionsBeforeErasure);
  check(state.database.account.find(row => row.userId === localUser.id && row.providerId === "credential").password.length > 0, true,
    "Discarding OAuth fields preserves credential passwords");
  persistentJar.set("tattoo-language", "en");
  response = await request("/sign-out", {}, persistentJar);
  check(response.status, 200);
  check(persistentJar.has("tinta-remember-login"), false, "Successful server sign-out removes the remembered-login preference");
  check(persistentJar.get("tattoo-language"), "en", "Sign-out preserves unrelated preferences");

  const formModule = await sourceModule("src/lib/appointment-form-model.ts");
  const appointmentModule = await sourceModule("src/lib/appointments.ts");
  const draftModule = await sourceModule("src/lib/appointment-draft.ts", { "./appointment-form-model": formModule, "./appointments": appointmentModule });
  const drafts = await import(draftModule);
  const storageRows = new Map();
  const storage = { get length() { return storageRows.size; }, key: index => [...storageRows.keys()][index] ?? null,
    getItem: key => storageRows.get(key) ?? null, setItem: (key, value) => storageRows.set(key, value), removeItem: key => storageRows.delete(key) };
  const noop = () => {};
  installGlobal("window", { sessionStorage: storage, addEventListener: noop, removeEventListener: noop,
    location: { replace: path => state.events.push(`navigate:${path}`) } });
  installGlobal("document", { documentElement: { lang: "en" }, visibilityState: "visible", body: { dataset: {} },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop });
  installGlobal("navigator", { onLine: true });
  installGlobal("MutationObserver", class { observe() {} disconnect() {} });
  const draft = { clientId: "private-client", date: "2026-10-09", time: "14:15", status: "CONFIRMED", designIds: ["private-design"],
    finalDesignId: "private-design", notes: "Private appointment note", agreedPrice: "100.00", depositRequired: "25.00", initialPayment: "25.00", moneyOpen: true };
  const prefix = "tinta:appointment-draft:";
  const key = drafts.appointmentDraftKey("artist-a", randomUUID());
  storage.setItem("unrelated-preference", "keep-me");
  check(drafts.storeAppointmentDraft(key, "/new-appointment", draft), true);
  check(drafts.parseAppointmentDraft(drafts.readAppointmentDraft(key), "/new-appointment"), draft, "Valid related-form draft still restores every field");
  check(drafts.parseAppointmentDraft(drafts.readAppointmentDraft(key), "/appointments/other/edit"), null, "A draft cannot restore on another booking");
  const expired = drafts.appointmentDraftKey("artist-a", randomUUID());
  storage.setItem(expired, JSON.stringify({ version: 1, path: "/new-appointment", savedAt: Date.now() - 2 * 60 * 60 * 1000, values: draft }));
  check(drafts.readAppointmentDraft(expired), null); check(storage.getItem(expired), null, "Reading an expired draft removes its stored private data");
  const oversized = drafts.appointmentDraftKey("artist-a", randomUUID()); storage.setItem(oversized, "x".repeat(100_001));
  check(drafts.readAppointmentDraft(oversized), null); check(storage.getItem(oversized), null);
  check(drafts.storeAppointmentDraft("unrelated-preference", "/new-appointment", draft), false, "Draft writes cannot affect unrelated browser data");
  for (let index = 0; index < 25; index++) check(drafts.storeAppointmentDraft(drafts.appointmentDraftKey("artist-a", randomUUID()), "/new-appointment", draft), true);
  check([...storageRows.keys()].filter(row => row.startsWith(prefix)).length, 20, "Abandoned drafts cannot grow without a bound");
  drafts.clearAppointmentDrafts();
  storage.setItem(expired, JSON.stringify({ version: 1, path: "/new-appointment", savedAt: Date.now() - 86_400_000, values: draft }));
  drafts.readAppointmentDraft(null); check(storage.getItem(expired), null, "Opening an unrelated booking prunes abandoned expired drafts");

  const uiModule = moduleUrl(`
    import { clearAppointmentDrafts as clear } from ${JSON.stringify(draftModule)};
    const state = globalThis.tintaPrivacyVerification;
    export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = "fragment";
    export const useState = initial => [initial, () => {}]; export const useRef = current => ({ current });
    export const useEffect = callback => state.effects.push(callback); export const useTransition = () => [false, callback => callback()];
    export const flushSync = callback => callback(); export const useClearWorkspace = () => () => state.events.push("workspace-hidden");
    export const clearAppointmentDrafts = () => { clear(); state.events.push("drafts-cleared"); };
    export const emitDiagnostic = () => null;
    export const setDiagnosticConsent = () => {};
    export const authClient = { signOut: async () => state.signOutFails ? { error: { message: "fixture failure" } } : {} };
    export const useRouter = () => ({ refresh() {} }); export const usePathname = () => "/calendar";
    export const useSearchParams = () => new URLSearchParams();
  `);
  const uiImports = Object.fromEntries(["react", "react/jsx-runtime", "react-dom", "next/navigation", "@/lib/auth-client",
    "@/components/workspace-access", "@/lib/client-diagnostics", "@/lib/appointment-draft"].map(name => [name, uiModule]));
  const { SignOutButton } = await import(await sourceModule("src/components/sign-out-button.tsx", uiImports, true));
  drafts.storeAppointmentDraft(key, "/new-appointment", draft);
  state.signOutFails = true; state.events = [];
  await SignOutButton({ label: "Sign out" }).props.children[0].props.onClick();
  check(storage.getItem(key) !== null, true, "Failed sign-out preserves the active draft"); check(state.events, []);
  state.signOutFails = false;
  await SignOutButton({ label: "Sign out" }).props.children[0].props.onClick();
  check(storage.getItem(key), null); check(storage.getItem("unrelated-preference"), "keep-me");
  check(state.events, ["drafts-cleared", "workspace-hidden", "navigate:/sign-in"], "Confirmed sign-out removes draft data before hiding and navigation");
  const { WorkspaceSync } = await import(await sourceModule("src/components/workspace-sync.tsx", uiImports, true));
  for (const status of [401, 403, 200]) {
    state.effects = []; state.events = []; drafts.storeAppointmentDraft(key, "/new-appointment", draft);
    installGlobal("fetch", async () => ({ status, ok: status === 200, json: async () => ({ workspaceId: "artist-b", revision: "0" }) }));
    WorkspaceSync({ workspaceId: "artist-a", revision: "0", locale: "en" });
    const cleanup = state.effects[1]();
    await new Promise(resolve => setImmediate(resolve)); cleanup();
    check(storage.getItem(key), null); check(storage.getItem("unrelated-preference"), "keep-me");
    check(state.events, ["drafts-cleared", "workspace-hidden", `navigate:${status === 200 ? "/calendar" : "/sign-in"}`], "Expired or changed accounts clear only Tinta drafts before navigation");
  }
  Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  check(drafts.readAppointmentDraft(key), null); check(drafts.storeAppointmentDraft(key, "/new-appointment", draft), false);
  assert.doesNotThrow(() => drafts.clearAppointmentDrafts()); checks++;
  console.log(`${checks} privacy minimization checks passed (isolated auth API and browser fixtures).`);
} finally {
  for (const [key, value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  for (const [name, descriptor] of Object.entries(originalGlobals)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  delete globalThis.tintaPrivacyVerification;
}
