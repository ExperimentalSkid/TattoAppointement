import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { test, expect } from "./fixtures";
import type { APIRequestContext, Page } from "@playwright/test";

const origin = "http://127.0.0.1:3000";
const password = "Report-QA-2026!";
const trigger = (page: Page) => page.getByRole("button", { name: /^(Report a problem|Informar de un problema)$/ }).first();
async function register(request: APIRequestContext, label: string) {
  const response = await request.post("/api/auth/sign-up/email", { headers: { Origin: origin }, data: { name: `QA ${label}`, email: `${label}-${randomUUID()}@example.com`, password } });
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}
async function rows(kind: "reports" | "diagnostics") {
  const directory = process.env.DIAGNOSTICS_DIR;
  if (!directory || !path.resolve(directory).includes(`${path.sep}.tmp${path.sep}`)) throw new Error("Logs must be QA-only .tmp files");
  const files = (await readdir(directory)).filter(file => file.startsWith(`${kind}-`) && file.endsWith(".jsonl"));
  return (await Promise.all(files.map(file => readFile(path.join(directory, file), "utf8")))).flatMap(text => text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)));
}
function payload(artistId: string | null, description: string) {
  return { reportId: randomUUID(), clickedAt: new Date().toISOString(), description, workspaceIdAtClick: artistId, recentEvents: [],
    context: { page: "/calendar", view: "week", timezone: "Europe/Madrid", deviceCategory: "phone", syncState: "current", online: true, calendarAnchor: "2026-10-05" } };
}

test("a mobile sign-in report keeps its original context without automatic diagnostics after a lost response", async ({ page }, testInfo) => {
  const optionalRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/diagnostics") optionalRequests.push(request.url()); });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/sign-in");
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "PRIVATE_TEST_SECRET", error: new Error("PRIVATE_TEST_SECRET") })));
  await trigger(page).click();
  await expect(page.locator("dialog")).toBeVisible();
  await expect(page.locator("#problem-description")).toBeFocused();
  const description = `QA lost response ${randomUUID()}`;
  await page.locator("#problem-description").fill(description);
  await page.screenshot({ path: testInfo.outputPath("report-mobile.png"), fullPage: true });
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/reports", async route => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (requests.length === 1) await route.abort(); else await route.fulfill({ response });
  });
  const send = page.locator("dialog button[type=submit]");
  await send.click();
  await expect(page.locator("dialog [role=alert]")).toBeVisible();
  await expect(page.locator("#problem-description")).toHaveValue(description);
  await send.click();
  await expect(page.locator(".problem-report-reference")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(JSON.stringify(requests[0])).not.toContain("PRIVATE_TEST_SECRET");
  expect(requests[0].context).toMatchObject({ page: "/sign-in", view: "auth", deviceCategory: "phone" });
  const stored = (await rows("reports")).filter(row => row.description === description);
  expect(stored).toHaveLength(1);
  expect(stored[0].artistId).toBeNull();
  expect(stored[0].recentEvents).toEqual([]);
  expect(optionalRequests).toEqual([]);
  expect(stored[0].clickedAt).toBe(requests[0].clickedAt);
});

test("report storage is session-bound, private and idempotent across independent artists", async ({ context, browser }) => {
  const artistA = await register(context.request, "report-a");
  const second = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.45.66.78" } });
  try {
    const artistB = await register(second.request, "report-b");
    const report = payload(artistA, `QA isolation ${randomUUID()}`);
    const first = await context.request.post("/api/reports", { headers: { Origin: origin }, data: report });
    expect(first.status()).toBe(200);
    const repeated = await context.request.post("/api/reports", { headers: { Origin: origin }, data: report });
    expect(await repeated.json()).toEqual(await first.json());
    expect((await second.request.post("/api/reports", { headers: { Origin: origin }, data: report })).status()).toBe(409);
    const other = await second.request.post("/api/reports", { headers: { Origin: origin }, data: { ...report, workspaceIdAtClick: artistB } });
    expect(other.status()).toBe(200);
    const stored = (await rows("reports")).filter(row => row.description === report.description);
    expect(stored.map(row => row.artistId).sort()).toEqual([artistA, artistB].sort());
    expect(stored[0].reference).not.toBe(stored[1].reference);
    expect((await context.request.get("/api/reports")).status()).toBe(405);
    expect((await context.request.get("/api/diagnostics")).status()).toBe(405);
    expect((await context.request.post("/api/reports", { headers: { Origin: "https://other.example" }, data: report })).status()).toBe(403);
    expect((await context.request.post("/api/reports", { headers: { Origin: origin }, data: { ...report, artistId: artistB } })).status()).toBe(400);
    expect((await context.request.post("/api/reports", { headers: { Origin: origin }, data: { ...report, description: "x".repeat(25 * 1024) } })).status()).toBe(413);
    const diagnostic = { id: randomUUID(), occurredAt: new Date().toISOString(), code: "action_failed", outcome: "failed", context: report.context, workspaceIdAtClick: artistA };
    expect((await context.request.post("/api/diagnostics", { headers: { Origin: origin }, data: diagnostic })).status()).toBe(403);
    const consent = await context.request.post("/api/preferences/diagnostics", { headers: { Origin: origin }, data: { enabled: true } });
    expect(consent.status(), "Explicit opt-in requires configured QA operator facts").toBe(200);
    expect((await context.request.post("/api/diagnostics", { headers: { Origin: origin }, data: diagnostic })).status()).toBe(202);
    expect((await second.request.post("/api/diagnostics", { headers: { Origin: origin }, data: diagnostic })).status()).toBe(409);
    expect((await rows("diagnostics")).find(row => row.id === diagnostic.id)?.artistId).toBe(artistA);
  } finally { await second.close(); }
});

test("reporting preserves an appointment draft and works offline without moving its page marker", async ({ page, context }, testInfo) => {
  await register(context.request, "report-draft");
  await page.goto("/new-appointment");
  const notes = page.locator("#appointment-notes");
  await notes.fill("PRIVATE_APPOINTMENT_DRAFT");
  await page.locator("#appointment-date").fill("2026-10-06");
  await trigger(page).click();
  const captured = await page.locator("dialog time").getAttribute("datetime");
  await expect(page.locator("body")).toHaveAttribute("data-problem-report-open", "true");
  await page.locator("#problem-description").fill(`QA offline ${randomUUID()}`);
  await context.setOffline(true);
  await page.locator("dialog button[type=submit]").click();
  await expect(page.locator("dialog [role=alert]")).toContainText(/sin conexión|offline/i);
  await context.setOffline(false);
  await page.locator("dialog button[type=submit]").click();
  await expect(page.locator(".problem-report-reference")).toBeVisible();
  const reference = await page.locator(".problem-report-reference").textContent();
  const stored = (await rows("reports")).find(row => row.reference === reference);
  expect(stored.clickedAt).toBe(captured);
  expect(JSON.stringify(stored)).not.toContain("PRIVATE_APPOINTMENT_DRAFT");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(notes).toHaveValue("PRIVATE_APPOINTMENT_DRAFT");
  await expect(page.locator("#appointment-date")).toHaveValue("2026-10-06");
  await expect(trigger(page)).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/calendar?view=week&anchor=2026-10-05");
  await trigger(page).click();
  await expect(page.locator(".problem-report-context")).toContainText("2026-10-05");
  await page.screenshot({ path: testInfo.outputPath("report-desktop.png"), fullPage: true });
});

test("a changed account requires explicit review before a pending report can be submitted", async ({ page, context, playwright }) => {
  test.setTimeout(30_000);
  await register(context.request, "report-account-a");
  // Keep the old view long enough to exercise the submission guard, before the
  // normal sync mechanism clears it after observing the new account cookie.
  await page.route("**/api/workspace/sync", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.goto("/calendar");
  await trigger(page).click();
  const description = `QA changed account ${randomUUID()}`;
  await page.locator("#problem-description").fill(description);
  const second = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.64.66.78" } });
  try {
    const artistB = await register(second, "report-account-b");
    await context.addCookies((await second.storageState()).cookies);
    await page.locator("dialog button[type=submit]").click();
    await expect(page.locator("dialog [role=alert]")).toContainText(/cuenta ha cambiado|account has changed/i);
    await expect(page.locator("#problem-description")).toHaveValue(description);
    expect((await rows("reports")).filter(row => row.description === description)).toHaveLength(0);
    await page.getByRole("button", { name: /Revisar con la cuenta actual|Review with the current account/ }).click();
    await expect(page.locator("dialog button[type=submit]")).toBeEnabled();
    expect((await rows("reports")).filter(row => row.description === description)).toHaveLength(0);
    await page.locator("dialog button[type=submit]").click({ timeout: 5_000 });
    await expect(page.locator(".problem-report-reference")).toBeVisible();
    const stored = (await rows("reports")).filter(row => row.description === description);
    expect(stored).toHaveLength(1);
    expect(stored[0].artistId).toBe(artistB);
  } finally { await second.dispose(); }
});

test("an artist can report a missing page without losing their account attribution", async ({ page, context }) => {
  const artist = await register(context.request, "report-404");
  await page.goto("/missing-report-qa-page");
  await trigger(page).click();
  const description = `QA missing page ${randomUUID()}`;
  await page.locator("#problem-description").fill(description);
  await expect(page.locator("dialog button[type=submit]")).toBeEnabled();
  await page.locator("dialog button[type=submit]").click();
  await expect(page.locator(".problem-report-reference")).toBeVisible();
  const stored = (await rows("reports")).filter(row => row.description === description);
  expect(stored).toHaveLength(1);
  expect(stored[0].artistId).toBe(artist);
  expect(stored[0].context.page).toBe("/unknown");
});

test("private logging storage failure does not prevent a new appointment from being saved", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const artistId = await register(context.request, "report-storage");
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/tinta_utf8_e2e" || process.env.ALLOW_TEST_DB_RESET !== "true") throw new Error("Only disposable QA data may be seeded");
  const pool = new Pool({ connectionString: url.href });
  const clientId = randomUUID();
  try { await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', [clientId, artistId, "QA client", "+34611000001"]); }
  finally { await pool.end(); }
  await page.goto("/new-appointment");
  await page.locator("#appointment-client").selectOption(clientId);
  await page.locator("#appointment-date").fill("2026-10-07");
  await page.locator("#appointment-time").fill("10:00");
  const qaRoot = path.resolve(".tmp");
  const directory = path.resolve(process.env.DIAGNOSTICS_DIR ?? "");
  const paused = path.join(qaRoot, `diagnostics-e2e-paused-${randomUUID()}`);
  if (directory !== path.join(qaRoot, "diagnostics-e2e") || !paused.startsWith(`${qaRoot}${path.sep}`)) throw new Error("Only the explicitly isolated QA logger may be paused");
  await rename(directory, paused);
  try {
    await writeFile(directory, "QA: logging deliberately unavailable");
    await page.locator(".appointment-form button[type=submit]").click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toMatch(/^\/appointments\/[A-Za-z0-9_-]+$/);
    await page.screenshot({ path: testInfo.outputPath("appointment-after-save.png") });
  } finally { await unlink(directory); await rename(paused, directory); }
  expect((await rows("diagnostics")).some(row => row.artistId === artistId && row.code === "appointment_create_saved")).toBe(false);
});
