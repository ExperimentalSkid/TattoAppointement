import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import ts from "typescript";

// Exercise the actual browser module in memory, without a database or files.
function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText).toString("base64")}`;
}
const contextUrl = moduleUrl(await readFile(new URL("../src/lib/diagnostic-context.ts", import.meta.url), "utf8"));
const diagnostics = await import(moduleUrl((await readFile(new URL("../src/lib/client-diagnostics.ts", import.meta.url), "utf8"))
  .replace('"@/lib/diagnostic-context"', JSON.stringify(contextUrl))));
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
const names = ["window", "document", "navigator", "fetch", "crypto"];
const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
let contextReads = 0, uuidReads = 0, online = false;
let requests = [];
const browserWindow = {
  get location() { contextReads++; return { pathname: "/calendar", search: "?view=week&anchor=2026-10-05" }; },
  crypto: { randomUUID() { uuidReads++; return randomUUID(); } },
  innerWidth: 500, setTimeout, clearTimeout,
};
try {
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: browserWindow.crypto });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => null } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get onLine() { return online; } } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: async (_url, options) => { requests.push(options); return new Response(null, { status: 202 }); } });
  diagnostics.setDiagnosticConsent(true);
  check(diagnostics.emitDiagnostic("browser_error"), null, "anonymous pages cannot collect, even when told to enable");
  diagnostics.setDiagnosticWorkspace("qa-artist-a");
  check(diagnostics.emitDiagnostic("browser_error"), null, "accounts start with consent off");
  check(contextReads, 0, "no page or browser context is read before consent");
  check(uuidReads, 0, "no event identifier is generated before consent");
  check(diagnostics.getRecentDiagnosticEvents(), []);
  diagnostics.setDiagnosticConsent(true);
  assert.ok(diagnostics.emitDiagnostic("browser_error")); checks++;
  check(diagnostics.getRecentDiagnosticEvents().length, 1, "consented offline events can be queued");
  check(requests.length, 0);
  diagnostics.setDiagnosticConsent(false);
  online = true;
  await diagnostics.flushDiagnosticEvents();
  check(requests.length, 0, "withdrawal discards the offline queue before reconnect");
  check(diagnostics.getRecentDiagnosticEvents(), []);

  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    requests.push(options);
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  diagnostics.setDiagnosticConsent(true);
  assert.ok(diagnostics.emitDiagnostic("unhandled_rejection")); checks++;
  check(requests.length, 1);
  diagnostics.setDiagnosticConsent(false);
  check(requests[0].signal.aborted, true, "withdrawal aborts in-flight delivery");
  await new Promise(resolve => setImmediate(resolve));
  check(diagnostics.getRecentDiagnosticEvents(), []);
  const readsAfterWithdrawal = contextReads;
  check(diagnostics.emitDiagnostic("browser_error"), null);
  check(contextReads, readsAfterWithdrawal, "withdrawal also closes context collection");
  diagnostics.setDiagnosticConsent(true);
  diagnostics.setDiagnosticWorkspace("qa-artist-b");
  check(diagnostics.emitDiagnostic("browser_error"), null, "consent never carries across workspaces");

  globalThis.fetch = async (_url, options) => { requests.push(options); return new Response(null, { status: 403 }); };
  diagnostics.setDiagnosticConsent(true);
  assert.ok(diagnostics.emitDiagnostic("browser_error")); checks++;
  await new Promise(resolve => setImmediate(resolve));
  check(diagnostics.getRecentDiagnosticEvents(), [], "server revocation clears local collection");
  check(diagnostics.emitDiagnostic("browser_error"), null);
  diagnostics.setDiagnosticWorkspace(null);
  diagnostics.setDiagnosticConsent(true);
  check(diagnostics.emitDiagnostic("browser_error"), null);
} finally {
  diagnostics.setDiagnosticConsent(false);
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

// Compile the real preference route with in-memory session/database boundaries.
// The JSON reader and same-origin checks are the real diagnostics helpers.
const loggerUrl = moduleUrl((await readFile(new URL("../src/lib/diagnostics.ts", import.meta.url), "utf8"))
  .replace('"./diagnostic-context"', JSON.stringify(contextUrl)));
const helperUrl = moduleUrl(`import { DiagnosticBodyError, diagnosticSameOrigin, readDiagnosticBody } from ${JSON.stringify(loggerUrl)};
  export { DiagnosticBodyError, diagnosticSameOrigin, readDiagnosticBody };
  export async function purgeAccountDiagnostics(...args) { return globalThis.__tintaConsentTest.purge(...args); }`);
const sessionUrl = moduleUrl("export async function getSession() { return globalThis.__tintaConsentTest.session; }");
const prismaUrl = moduleUrl("export const prisma = { $transaction: async work => work(globalThis.__tintaConsentTest.tx) };");
const privacyUrl = moduleUrl("export function getPrivacyConfig() { return { isConfigured: globalThis.__tintaConsentTest.configured }; }");
const routeSource = (await readFile(new URL("../src/app/api/preferences/diagnostics/route.ts", import.meta.url), "utf8"))
  .replace('"@/lib/session"', JSON.stringify(sessionUrl)).replace('"@/lib/prisma"', JSON.stringify(prismaUrl))
  .replace('"@/lib/privacy-config"', JSON.stringify(privacyUrl)).replace('"@/lib/diagnostics"', JSON.stringify(helperUrl));
const route = await import(moduleUrl(routeSource));
const origin = "http://127.0.0.1:3000";
const previousOrigin = process.env.BETTER_AUTH_URL;
const state = { configured: false, session: { user: { id: "qa-actor" } }, active: true, pendingPurge: null, updates: [], purges: [], purgeResult: true };
state.purge = async (...args) => { state.purges.push(args); return state.purgeResult; };
state.tx = { $executeRaw: async () => 1, $queryRaw: async () => [], user: {
  findFirst: async () => state.active ? { id: "qa-actor", diagnosticsPurgeRequestedAt: state.pendingPurge } : null,
  update: async value => { state.updates.push(value); if ("diagnosticsPurgeRequestedAt" in value.data) state.pendingPurge = value.data.diagnosticsPurgeRequestedAt; return {}; },
} };
globalThis.__tintaConsentTest = state;
process.env.BETTER_AUTH_URL = origin;
function preference(body, requestOrigin = origin) {
  return new Request(`${origin}/api/preferences/diagnostics`, { method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(body) });
}
try {
  state.session = null;
  check((await route.POST(preference({ enabled: false }))).status, 401);
  state.session = { user: { id: "qa-actor" } };
  check((await route.POST(preference({ enabled: false }, "https://other.example"))).status, 403);
  check((await route.POST(preference({ enabled: false, artistId: "forged-actor" }))).status, 400);
  check((await route.POST(preference({ enabled: "true" }))).status, 400);
  check((await route.POST(preference({ enabled: false, padding: "x".repeat(200) }))).status, 413);
  check((await route.POST(preference({ enabled: true }))).status, 409, "missing legal facts block opt-in");
  check(state.updates.length, 0);
  const withdrawal = await route.POST(preference({ enabled: false }));
  check(withdrawal.status, 200, "withdrawal remains available with missing legal facts");
  check(await withdrawal.json(), { enabled: false, workspaceId: "qa-actor" });
  check(state.purges, [["qa-actor", true]], "only actor-owned optional events are purged");
  check(state.updates[0].where, { id: "qa-actor" }, "the server derives the actor");
  check(state.updates[0].data.diagnosticsConsent, false);
  check(state.updates[0].data.diagnosticsConsentNoticeVersion, "2026-10-05");
  assert.ok(state.updates[0].data.diagnosticsConsentUpdatedAt instanceof Date); checks++;
  state.configured = true;
  check((await route.POST(preference({ enabled: true }))).status, 200);
  check(state.updates.at(-1).data.diagnosticsConsent, true);
  check(state.purges.length, 1, "opt-in does not purge manual reports or necessary logs");
  state.purgeResult = false;
  const failedCleanup = await route.POST(preference({ enabled: false }));
  check(failedCleanup.status, 503);
  check(await failedCleanup.json(), { enabled: false, workspaceId: "qa-actor", error: "cleanup_unavailable" });
  check(state.updates.at(-1).data.diagnosticsConsent, false, "a retryable purge failure still revokes consent");
  assert.ok(state.pendingPurge instanceof Date); checks++;
  const prematureOptIn = await route.POST(preference({ enabled: true }));
  check(prematureOptIn.status, 503, "old withdrawn events must be purged before accepting a new opt-in");
  check((await prematureOptIn.json()).enabled, false);
  check(state.updates.at(-1).data.diagnosticsConsent, false);
  assert.ok(state.pendingPurge instanceof Date); checks++;
  state.purgeResult = true;
  check((await route.POST(preference({ enabled: true }))).status, 200);
  check(state.pendingPurge, null, "successful cleanup clears the durable retry flag");
  check(state.updates.at(-1).data.diagnosticsConsent, true);
  state.active = false;
  check((await route.POST(preference({ enabled: false }))).status, 401);
} finally {
  delete globalThis.__tintaConsentTest;
  if (previousOrigin === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = previousOrigin;
}
console.log(`Optional browser diagnostics consent and preference intake: ${checks} checks passed.`);
