import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures";

const origin = "http://127.0.0.1:3000";
const originHeaders = { Origin: origin };
async function register(request: APIRequestContext, label: string) {
  const response = await request.post("/api/auth/sign-up/email", { headers: originHeaders,
    data: { name: `QA ${label}`, email: `${label}-${randomUUID()}@example.com`, password: "Privacy-Consent-QA-2026!" } });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}
function database() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) throw new Error("Only a disposable _e2e database may be inspected");
  return new Pool({ connectionString: url.href });
}
async function consent(request: APIRequestContext, enabled: boolean) {
  return request.post("/api/preferences/diagnostics", { headers: originHeaders, data: { enabled } });
}
async function optIn(request: APIRequestContext) {
  const response = await consent(request, true);
  expect(response.status(), "Opt-in tests require fully configured QA-only operator facts").toBe(200);
  expect((await response.json()).enabled).toBe(true);
}
function event(actor: string | null) {
  return { id: randomUUID(), occurredAt: new Date().toISOString(), code: "browser_error", outcome: "failed", reason: "unknown", workspaceIdAtClick: actor,
    context: { page: "/settings", view: "settings", timezone: "Europe/Madrid", deviceCategory: "desktop", syncState: "current", online: true, calendarAnchor: null } };
}
async function rows(kind: "diagnostics" | "reports") {
  const directory = path.resolve(process.env.DIAGNOSTICS_DIR ?? "");
  const qaRoot = path.resolve(".tmp");
  if (!directory.startsWith(`${qaRoot}${path.sep}`)) throw new Error("Only private QA logs may be inspected");
  const files = (await readdir(directory)).filter(file => new RegExp(`^${kind}-\\d{4}-\\d{2}-\\d{2}\\.jsonl$`).test(file));
  return (await Promise.all(files.map(file => readFile(path.join(directory, file), "utf8"))))
    .flatMap(text => text.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>));
}

test("diagnostics require explicit actor consent and withdrawal preserves support reports and necessary logs", async ({ context, browser }) => {
  const artistA = await register(context.request, "consent-a");
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.32.67.89" } });
  const anonymous = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.32.67.90" } });
  const pool = database();
  try {
    const artistB = await register(peer.request, "consent-b");
    const diagnosticA = event(artistA), diagnosticB = event(artistB);
    expect((await anonymous.request.post("/api/diagnostics", { headers: originHeaders, data: event(null) })).status()).toBe(401);
    expect((await consent(anonymous.request, false)).status()).toBe(401);
    expect((await context.request.post("/api/diagnostics", { headers: originHeaders, data: diagnosticA })).status()).toBe(403);
    expect((await context.request.post("/api/preferences/diagnostics", { headers: { Origin: "https://other.example" }, data: { enabled: true } })).status()).toBe(403);
    expect((await context.request.post("/api/preferences/diagnostics", { headers: originHeaders, data: { enabled: true, artistId: artistB } })).status()).toBe(400);
    expect((await context.request.post("/api/preferences/diagnostics", { headers: originHeaders, data: { enabled: "true" } })).status()).toBe(400);
    expect((await context.request.post("/api/preferences/diagnostics", { headers: originHeaders, data: { enabled: false, extra: "x".repeat(200) } })).status()).toBe(413);
    await optIn(context.request); await optIn(peer.request);
    const evidence = await pool.query('SELECT "diagnosticsConsent","diagnosticsConsentUpdatedAt","diagnosticsConsentNoticeVersion","diagnosticsPurgeRequestedAt" FROM "user" WHERE id=$1', [artistA]);
    expect(evidence.rows[0].diagnosticsConsent).toBe(true);
    expect(evidence.rows[0].diagnosticsConsentUpdatedAt).toBeInstanceOf(Date);
    expect(evidence.rows[0].diagnosticsConsentNoticeVersion).toBe("2026-10-05");
    expect(evidence.rows[0].diagnosticsPurgeRequestedAt).toBeNull();
    expect((await context.request.post("/api/diagnostics", { headers: originHeaders, data: diagnosticA })).status()).toBe(202);
    expect((await peer.request.post("/api/diagnostics", { headers: originHeaders, data: diagnosticA })).status()).toBe(409);
    expect((await peer.request.post("/api/diagnostics", { headers: originHeaders, data: diagnosticB })).status()).toBe(202);
    const manual = { reportId: randomUUID(), clickedAt: new Date().toISOString(), description: `QA consent manual ${randomUUID()}`,
      context: diagnosticA.context, workspaceIdAtClick: artistA, recentEvents: [] };
    expect((await context.request.post("/api/reports", { headers: originHeaders, data: manual })).status()).toBe(200);
    const necessary = (await rows("diagnostics")).filter(row => row.artistId === artistA && row.source === "server");
    expect(necessary.length).toBeGreaterThan(0);
    const withdrawal = await consent(context.request, false);
    expect(withdrawal.status()).toBe(200);
    expect(await withdrawal.json()).toMatchObject({ enabled: false, workspaceId: artistA });
    const after = await rows("diagnostics");
    expect(after.some(row => row.id === diagnosticA.id)).toBe(false);
    expect(after.some(row => row.id === diagnosticB.id && row.artistId === artistB)).toBe(true);
    for (const retained of necessary) expect(after.some(row => row.id === retained.id)).toBe(true);
    expect((await rows("reports")).some(row => row.description === manual.description && row.artistId === artistA)).toBe(true);
    expect((await context.request.post("/api/diagnostics", { headers: originHeaders, data: event(artistA) })).status()).toBe(403);
    const withdrawn = await pool.query('SELECT "diagnosticsConsent","diagnosticsPurgeRequestedAt" FROM "user" WHERE id=$1', [artistA]);
    expect(withdrawn.rows[0]).toMatchObject({ diagnosticsConsent: false, diagnosticsPurgeRequestedAt: null });
  } finally { await pool.end(); await peer.close(); await anonymous.close(); }
});

test("browser diagnostics stay off until opt-in and offline withdrawal discards queued context", async ({ page, context }) => {
  const actor = await register(context.request, "consent-browser");
  const sent: Record<string, unknown>[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/diagnostics") sent.push(request.postDataJSON()); });
  await page.goto("/settings");
  const form = page.locator(".privacy-settings-form"), checkbox = form.locator("#optional-diagnostics");
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "PRIVATE_DEFAULT_OFF_ERROR" })));
  expect(sent).toEqual([]);
  await checkbox.check(); await form.locator("button[type=submit]").click();
  await expect(form.locator("[role=status]")).toBeVisible();
  await expect(page.locator("[data-diagnostic-workspace]")).toHaveAttribute("data-diagnostic-consent", "true");
  const accepted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/diagnostics" && response.status() === 202);
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "PRIVATE_OPTED_IN_ERROR" })));
  await accepted;
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent)).not.toContain("PRIVATE_OPTED_IN_ERROR");
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(), reason: "PRIVATE_OFFLINE_REASON" })));
  await checkbox.uncheck(); await form.locator("button[type=submit]").click();
  await expect(form.locator("[role=alert]")).toContainText(/detenidos|stopped/i);
  await expect(page.locator("[data-diagnostic-workspace]")).toHaveAttribute("data-diagnostic-consent", "false");
  await context.setOffline(false);
  await expect(checkbox).not.toBeChecked();
  // Saving needs an explicit retry; reconnect must not deliver the old queue.
  expect(sent).toHaveLength(1);
  await form.locator("button[type=submit]").click();
  await expect(form.locator("[role=status]")).toBeVisible();
  expect((await rows("diagnostics")).filter(row => row.artistId === actor && row.source === "client")).toEqual([]);
  const reportRequest = page.waitForRequest(request => new URL(request.url()).pathname === "/api/reports");
  await page.getByRole("button", { name: /^(Informar de un problema|Report a problem)$/ }).first().click();
  await page.locator("#problem-description").fill(`QA after withdrawal ${randomUUID()}`);
  await page.locator("dialog button[type=submit]").click();
  expect((await reportRequest).postDataJSON().recentEvents).toEqual([]);
  await expect(page.locator(".problem-report-reference")).toBeVisible();
  expect(sent).toHaveLength(1);
});

test("a lost opt-in response keeps the choice for manual retry and does not start local collection", async ({ page, context }) => {
  await register(context.request, "consent-retry");
  await page.goto("/settings");
  const form = page.locator(".privacy-settings-form"), checkbox = form.locator("#optional-diagnostics");
  let attempts = 0, events = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/diagnostics") events++; });
  await page.route("**/api/preferences/diagnostics", async route => {
    attempts++;
    const response = await route.fetch();
    if (attempts === 1) await route.abort(); else await route.fulfill({ response });
  });
  await checkbox.check(); await form.locator("button[type=submit]").click();
  await expect(form.locator("[role=alert]")).toBeVisible();
  await expect(checkbox).toBeChecked();
  await expect(page.locator("[data-diagnostic-workspace]")).toHaveAttribute("data-diagnostic-consent", "false");
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "PRIVATE_FAILED_OPT_IN" })));
  expect(events).toBe(0); expect(attempts).toBe(1);
  await form.locator("button[type=submit]").click();
  await expect(form.locator("[role=status]")).toBeVisible();
  await expect(page.locator("[data-diagnostic-workspace]")).toHaveAttribute("data-diagnostic-consent", "true");
  expect(attempts).toBe(2);
});

test("another device can withdraw while a business draft is open and settings reconcile after the draft closes", async ({ page, context, browser }) => {
  await register(context.request, "consent-remote");
  await optIn(context.request);
  const remote = await browser.newContext({ baseURL: origin });
  await remote.addCookies((await context.storageState()).cookies);
  try {
    await page.goto("/settings");
    const checkbox = page.locator("#optional-diagnostics");
    await expect(checkbox).toBeChecked();
    const studio = page.locator("#studio-name"), originalStudio = await studio.inputValue();
    const draft = `QA retained studio ${randomUUID()}`;
    await studio.fill(draft);
    await page.locator(".page-heading").click();
    let automaticEvents = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/diagnostics") automaticEvents++; });
    expect((await consent(remote.request, false)).status()).toBe(200);
    await expect(page.locator("[data-diagnostic-workspace]")).toHaveAttribute("data-diagnostic-consent", "false", { timeout: 20_000 });
    await expect(studio).toHaveValue(draft);
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "PRIVATE_AFTER_REMOTE_WITHDRAWAL" })));
    expect(automaticEvents).toBe(0);
    await studio.fill(originalStudio); await page.locator(".page-heading").click();
    await expect(checkbox).not.toBeChecked({ timeout: 20_000 });
    await optIn(remote.request);
    await expect(checkbox).toBeChecked({ timeout: 20_000 });
    await expect(page.locator("[data-diagnostic-workspace]")).toHaveAttribute("data-diagnostic-consent", "true");
  } finally { await remote.close(); }
});

test("unavailable private storage leaves withdrawal durable and blocks re-opt-in until old events are purged", async ({ context }) => {
  const actor = await register(context.request, "consent-purge-retry");
  await optIn(context.request);
  const optional = event(actor);
  expect((await context.request.post("/api/diagnostics", { headers: originHeaders, data: optional })).status()).toBe(202);
  const qaRoot = path.resolve(".tmp"), directory = path.resolve(process.env.DIAGNOSTICS_DIR ?? "");
  const paused = path.join(qaRoot, `consent-logger-paused-${randomUUID()}`);
  if (directory !== path.join(qaRoot, "diagnostics-e2e") || !paused.startsWith(`${qaRoot}${path.sep}`)) throw new Error("Only the explicitly isolated QA logger may be paused");
  const pool = database();
  try {
    await rename(directory, paused);
    try {
      await writeFile(directory, "QA: diagnostics cleanup deliberately unavailable");
      const withdrawal = await consent(context.request, false);
      expect(withdrawal.status()).toBe(503);
      expect(await withdrawal.json()).toMatchObject({ enabled: false, error: "cleanup_unavailable" });
      const pending = await pool.query('SELECT "diagnosticsConsent","diagnosticsPurgeRequestedAt" FROM "user" WHERE id=$1', [actor]);
      expect(pending.rows[0].diagnosticsConsent).toBe(false);
      expect(pending.rows[0].diagnosticsPurgeRequestedAt).toBeInstanceOf(Date);
      expect((await context.request.post("/api/diagnostics", { headers: originHeaders, data: event(actor) })).status()).toBe(403);
      const tooEarly = await consent(context.request, true);
      expect(tooEarly.status()).toBe(503);
      expect((await tooEarly.json()).enabled).toBe(false);
    } finally { await unlink(directory); await rename(paused, directory); }
    await optIn(context.request);
    const recovered = await pool.query('SELECT "diagnosticsConsent","diagnosticsPurgeRequestedAt" FROM "user" WHERE id=$1', [actor]);
    expect(recovered.rows[0]).toMatchObject({ diagnosticsConsent: true, diagnosticsPurgeRequestedAt: null });
    expect((await rows("diagnostics")).some(row => row.id === optional.id)).toBe(false);
  } finally { await pool.end(); }
});

test("concurrent optional intake cannot recreate an artist's events after withdrawal completes", async ({ context }) => {
  const actor = await register(context.request, "consent-race");
  await optIn(context.request);
  const pool = database(), blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [actor]);
    const withdrawal = consent(context.request, false);
    await expect.poll(async () => (await pool.query("SELECT count(*)::integer AS waiting FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].waiting).toBeGreaterThan(0);
    const intake = Array.from({ length: 4 }, () => context.request.post("/api/diagnostics", { headers: originHeaders, data: event(actor) }));
    await blocker.query("COMMIT");
    expect((await withdrawal).status()).toBe(200);
    for (const response of await Promise.all(intake)) expect(response.status()).toBe(403);
    expect((await rows("diagnostics")).filter(row => row.artistId === actor && row.source === "client")).toEqual([]);
  } finally { await blocker.query("ROLLBACK").catch(() => {}); blocker.release(); await pool.end(); }
});
