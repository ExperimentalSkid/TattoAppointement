import { createHash } from "node:crypto";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "./fixtures";
import { fillAppointmentStart, revealAppointmentMoney } from "./appointment-helpers";

const password = "Workspace-Sync-2026!";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Workspace sync tests require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function signUp(page: Page) {
  await page.goto("/sign-up");
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  }
  await page.locator("#name").fill("Workspace sync artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill(password);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

// Authenticate independently: copying cookies would test two tabs of one session,
// whereas these checks need separate devices with independently revocable sessions.
async function openPeer(browser: Browser, testInfo: TestInfo) {
  const before = await withTestDatabase(pool => pool.query<{ id: string }>('SELECT id FROM "session"'));
  const baseURL = String(testInfo.project.use.baseURL);
  const address = createHash("sha256").update(`${testInfo.testId}:peer`).digest();
  const context = await browser.newContext({
    baseURL, timezoneId: "Europe/Madrid",
    extraHTTPHeaders: { "x-forwarded-for": `10.${address[0]}.${address[1]}.${address[2]}` },
  });
  const response = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin: baseURL }, data: { email: "owner@example.com", password },
  });
  expect(response.status()).toBe(200);
  const after = await withTestDatabase(pool => pool.query<{ id: string }>('SELECT id FROM "session"'));
  const previousIds = new Set(before.rows.map(row => row.id));
  const sessions = after.rows.filter(row => !previousIds.has(row.id));
  expect(sessions).toHaveLength(1);
  const page = await context.newPage();
  await page.goto("/calendar");
  await expect(page.locator(".app-shell")).toBeVisible();
  return { context, page, sessionId: sessions[0].id };
}

async function createClient(page: Page, name = "Sync tattoo client") {
  await page.goto("/clients/new");
  await page.locator("#client-name").fill(name);
  await page.locator("#client-phone").fill("+34611000400");
  await page.locator("#client-notes").fill("Original placement notes");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function editClient(page: Page, path: string, name: string, notes: string) {
  await page.goto(`${path}/edit`);
  await page.locator("#client-name").fill(name);
  await page.locator("#client-notes").fill(notes);
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === path);
}

async function uploadArtwork(page: Page, title = "Sync tattoo artwork") {
  const response = await page.request.post("/api/designs", {
    multipart: { title, image: { name: "sync.png", mimeType: "image/png", buffer: png } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

async function createAppointment(page: Page, designId: string, notes: string, initialPayment = "0.00") {
  await page.goto("/new-appointment?date=2026-11-05");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await fillAppointmentStart(page, "2026-11-05T10:00");
  await page.locator(`input[name='designIds'][value='${designId}']`).check();
  await page.locator("#appointment-notes").fill(notes);
  await revealAppointmentMoney(page);
  await page.locator("#agreed-price").fill("250.00");
  await page.locator("#deposit-required").fill("50.00");
  await page.locator("#initial-payment").fill(initialPayment);
  await expect(page.locator("input[name='allowOverlap']")).toHaveValue("false");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function expectSyncState(page: Page, state: string) {
  await expect(page.locator(".workspace-sync-status")).toHaveAttribute("data-state", state);
}

test("another signed-in device receives bookings and cancellations without losing its selected day or tattoo history", async ({ page, browser }, testInfo) => {
  await signUp(page);
  const clientPath = await createClient(page);
  const designId = await uploadArtwork(page);
  const peer = await openPeer(browser, testInfo);
  try {
    const calendarPath = "/calendar?view=day&anchor=2026-11-05";
    await peer.page.goto(calendarPath);
    await expectSyncState(peer.page, "current");
    let reloads = 0;
    peer.page.on("load", () => { reloads += 1; });
    const appointmentPath = await createAppointment(page, designId, "Keep this tattoo history", "25.00");
    await expect(peer.page.locator(`.calendar-page a[href='${appointmentPath}']`)).toBeVisible();
    await expect(peer.page.locator(".calendar-session-count strong")).toHaveText("01");
    await expect(peer.page).toHaveURL(url => `${url.pathname}${url.search}` === calendarPath);
    expect(reloads).toBe(0);

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
    await expect(page.locator("[data-status='CANCELLED']")).toBeVisible();
    await expect(peer.page.locator(`.calendar-page a[href='${appointmentPath}']`)).toHaveCount(0);
    await expect(peer.page.locator(".calendar-session-count strong")).toHaveText("00");
    expect(reloads).toBe(0);

    await peer.page.goto(clientPath);
    await expect(peer.page.locator(`.appointment-history a[href='${appointmentPath}'] [data-status='CANCELLED']`)).toBeVisible();
    await peer.page.goto(appointmentPath);
    await expect(peer.page.locator(".appointment-notes")).toHaveText("Keep this tattoo history");
    await expect(peer.page.locator(".appointment-design-gallery")).toContainText("Sync tattoo artwork");
    await expect(peer.page.locator(".payment-history-list li")).toContainText("25.00");

    await peer.page.goto(calendarPath);
    const replacementPath = await createAppointment(page, designId, "New booking in the freed slot");
    await expect(peer.page.locator(`.calendar-page a[href='${replacementPath}']`)).toBeVisible();
    await expect(peer.page.locator(`.calendar-page a[href='${appointmentPath}']`)).toHaveCount(0);
    await expect(peer.page.locator(".calendar-session-count strong")).toHaveText("01");
  } finally { await peer.context.close(); }
});

test("open client, artwork, payment and settings views receive the other device's saved changes", async ({ page, browser }, testInfo) => {
  await signUp(page);
  const clientPath = await createClient(page);
  const designId = await uploadArtwork(page);
  const appointmentPath = await createAppointment(page, designId, "Tattoo payment sync");
  const peer = await openPeer(browser, testInfo);
  try {
    await peer.page.goto("/clients?q=Sync");
    await editClient(page, clientPath, "Sync client revised", "Latest private tattoo notes");
    await expect(peer.page.locator(`.client-list-item[href^='${clientPath}']`)).toContainText("Sync client revised");
    await expect(peer.page.locator("input[name='q']")).toHaveValue("Sync");

    await peer.page.goto("/designs?q=Sync");
    const addedId = await uploadArtwork(page, "Sync second artwork");
    await expect(peer.page.locator(`.design-card[href^='/designs/${addedId}']`)).toBeVisible();
    await page.goto(`/designs/${designId}/edit`);
    await page.locator("#design-title").fill("Sync revised artwork");
    await page.locator(".design-form").getByRole("button", { name: "Save changes", exact: true }).click();
    await page.waitForURL(url => url.pathname === `/designs/${designId}`);
    await expect(peer.page.locator(`.design-card[href^='/designs/${designId}']`)).toContainText("Sync revised artwork");
    const privateImage = await peer.page.request.get(`/api/designs/${addedId}/image?variant=preview`);
    expect(privateImage.status()).toBe(200);
    expect(privateImage.headers()["cache-control"]).toContain("private");
    expect(privateImage.headers()["cache-control"]).toContain("no-store");

    await peer.page.goto(appointmentPath);
    await page.goto(appointmentPath);
    await page.locator("#payment-amount").fill("37.50");
    await page.locator(".payment-entry-form button[type='submit']").click();
    await expect(page.locator(".payment-history-list li")).toHaveCount(1);
    await expect(peer.page.locator(".payment-history-list li")).toContainText("37.50");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Remove payment", exact: true }).click();
    await expect(peer.page.locator(".payment-history-list li")).toHaveCount(0);

    await peer.page.goto("/settings");
    await page.goto("/settings");
    await page.locator("#studio-name").fill("Atelier Sync");
    await page.locator(".studio-settings-form button[type='submit']").click();
    await expect(page.locator(".studio-settings-form .settings-success")).toBeVisible();
    await expect(peer.page.locator(".topbar-app-name")).toHaveText("Atelier Sync");
    await expect(peer.page.locator("#studio-name")).toHaveValue("Atelier Sync");
    await expect(peer.page.locator("#whatsapp-reminder-preview")).toContainText("Atelier Sync");
    const reminder = "Hello {client}, your tattoo at {studio}: {date}, {time}.";
    await page.locator("#whatsapp-reminder-template").fill(reminder);
    await page.locator(".reminder-settings-form button[type='submit']").click();
    await expect(peer.page.locator("#whatsapp-reminder-template")).toHaveValue(reminder);
  } finally { await peer.context.close(); }
});

test("competing saves keep client and settings drafts and reject stale writes atomically", async ({ page, browser }, testInfo) => {
  await signUp(page);
  const clientPath = await createClient(page);
  const peer = await openPeer(browser, testInfo);
  try {
    await peer.page.goto(`${clientPath}/edit`);
    await peer.page.locator("#client-name").fill("My unsaved client name");
    await peer.page.locator("#client-notes").fill("My complete private draft\nKeep both lines.");
    await editClient(page, clientPath, "Saved on the other device", "Latest placement agreed with client");
    await expectSyncState(peer.page, "pending");
    await expect(peer.page.locator("#client-name")).toHaveValue("My unsaved client name");
    await expect(peer.page.locator("#client-notes")).toHaveValue("My complete private draft\nKeep both lines.");
    await peer.page.setViewportSize({ width: 390, height: 844 });
    expect(await peer.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const screenshot = testInfo.outputPath("sync-draft-protected.png");
    await peer.page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("Protected draft on another device", { path: screenshot, contentType: "image/png" });
    await peer.page.getByRole("button", { name: "Review updates", exact: true }).click();
    await peer.page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(peer.page.locator("#client-notes")).toHaveValue("My complete private draft\nKeep both lines.");
    await peer.page.locator(".client-form button[type='submit']").click();
    const conflict = peer.page.locator("[data-sync-conflict]");
    await expect(conflict).toBeVisible();
    await expect(conflict).toHaveAttribute("role", "alert");
    await expect(conflict).toContainText("This record changed on another device.");
    await expect(conflict.getByRole("link", { name: "Review latest version", exact: true })).toHaveAttribute("target", "_blank");
    await expect(peer.page.locator("#client-name")).toHaveValue("My unsaved client name");
    await expect(peer.page.locator("#client-notes")).toHaveValue("My complete private draft\nKeep both lines.");
    const saved = await withTestDatabase(pool => pool.query('SELECT name,phone,notes FROM "Client" WHERE id=$1', [clientPath.split("/").at(-1)]));
    expect(saved.rows).toEqual([{ name: "Saved on the other device", phone: "+34611000400", notes: "Latest placement agreed with client" }]);

    await peer.page.goto("/settings");
    await peer.page.locator("#studio-name").fill("My unsaved studio identity");
    await page.goto("/settings");
    await page.locator("#studio-name").fill("Studio identity saved elsewhere");
    await page.locator(".studio-settings-form button[type='submit']").click();
    await expect(page.locator(".studio-settings-form .settings-success")).toBeVisible();
    await expectSyncState(peer.page, "pending");
    // Settings language changes refresh the route independently of automatic
    // sync. That rendering must retain the draft and its original stale baseline.
    await peer.page.locator(".app-topbar .language-select").selectOption("es");
    await expect(peer.page.locator(".app-topbar .language-select")).toHaveValue("es");
    await expect(peer.page.locator("#studio-name")).toHaveValue("My unsaved studio identity");
    await peer.page.locator(".app-topbar .language-select").selectOption("en");
    await expect(peer.page.locator(".app-topbar .language-select")).toHaveValue("en");
    await peer.page.locator(".studio-settings-form button[type='submit']").click();
    await expect(peer.page.locator(".studio-settings-form [data-sync-conflict]")).toContainText("This record changed on another device.");
    await expect(peer.page.locator("#studio-name")).toHaveValue("My unsaved studio identity");
    const profile = await withTestDatabase(pool => pool.query('SELECT "studioName" FROM "user" WHERE email=$1', ["owner@example.com"]));
    expect(profile.rows).toEqual([{ studioName: "Studio identity saved elsewhere" }]);
  } finally { await peer.context.close(); }
});

test("a collapsed reschedule draft survives a cancellation from another device", async ({ page, browser }, testInfo) => {
  await signUp(page);
  await createClient(page);
  const designId = await uploadArtwork(page);
  const appointmentPath = await createAppointment(page, designId, "Preserve the cancelled tattoo history");
  const peer = await openPeer(browser, testInfo);
  try {
    await peer.page.goto(appointmentPath);
    const toggle = peer.page.getByRole("button", { name: "Reschedule", exact: true });
    await toggle.click();
    await peer.page.locator("#reschedule-date").fill("2026-11-06");
    await peer.page.locator("#reschedule-time").fill("11:45");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(peer.page.locator(".appointment-reschedule-form")).not.toBeVisible();

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
    await expect(page.locator(".appointment-detail-header [data-status='CANCELLED']")).toBeVisible();
    await expectSyncState(peer.page, "pending");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(peer.page.locator("#reschedule-date")).toHaveValue("2026-11-06");
    await expect(peer.page.locator("#reschedule-time")).toHaveValue("11:45");
    await peer.page.locator(".appointment-reschedule-form button[type='submit']").click();
    await expect(peer.page.locator("[data-sync-conflict]")).toContainText("This record changed on another device.");
    await expect(peer.page.locator("#reschedule-date")).toHaveValue("2026-11-06");
    await expect(peer.page.locator("#reschedule-time")).toHaveValue("11:45");
    const saved = await withTestDatabase(pool => pool.query('SELECT status,notes,to_char("startsAt",\'YYYY-MM-DD"T"HH24:MI\') AS "startsAt" FROM "Appointment" WHERE id=$1', [appointmentPath.split("/").at(-1)]));
    expect(saved.rows).toEqual([{ status: "CANCELLED", notes: "Preserve the cancelled tattoo history", startsAt: "2026-11-05T09:00" }]);
  } finally { await peer.context.close(); }
});

test("failed sync polls recover automatically and reconnecting keeps an unsaved draft", async ({ page, browser }, testInfo) => {
  await signUp(page);
  const clientPath = await createClient(page);
  const peer = await openPeer(browser, testInfo);
  try {
    await peer.page.goto("/clients?q=Sync");
    await expectSyncState(peer.page, "current");
    let failing = true;
    await peer.page.route("**/api/workspace/sync", async route => {
      if (failing) await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"temporarily_unavailable"}' });
      else await route.continue();
    });
    await expectSyncState(peer.page, "error");
    await editClient(page, clientPath, "Sync after failed poll", "Recovered private note");
    await expect(peer.page.locator(`.client-list-item[href^='${clientPath}']`)).toContainText("Sync tattoo client");
    failing = false;
    await expect(peer.page.locator(`.client-list-item[href^='${clientPath}']`)).toContainText("Sync after failed poll");
    await expectSyncState(peer.page, "current");

    await peer.page.goto(`${clientPath}/edit`);
    await peer.page.locator("#client-notes").fill("Offline draft kept on this device");
    await peer.context.setOffline(true);
    await expectSyncState(peer.page, "offline");
    await editClient(page, clientPath, "Sync changed while offline", "Other device's saved note");
    await expect(peer.page.locator("#client-notes")).toHaveValue("Offline draft kept on this device");
    await peer.context.setOffline(false);
    await expectSyncState(peer.page, "pending");
    await expect(peer.page.locator("#client-notes")).toHaveValue("Offline draft kept on this device");
    await expect(peer.page.locator("#client-name")).toHaveValue("Sync after failed poll");
  } finally { await peer.context.close(); }
});

test("a stalled page refresh remains visible while healthy revision polls continue and preserves a draft entered during loading", async ({ page, browser }, testInfo) => {
  await signUp(page);
  const peer = await openPeer(browser, testInfo);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    let healthyPolls = 0;
    peer.page.on("response", response => {
      if (new URL(response.url()).pathname === "/api/workspace/sync" && response.status() === 200) healthyPolls += 1;
    });
    await peer.page.goto("/settings");
    // Let the initial route catch-up settle before holding the later refresh.
    await expect.poll(() => healthyPolls).toBeGreaterThanOrEqual(2);
    await expectSyncState(peer.page, "current");
    const originalBaseline = await peer.page.locator("input[name='expectedProfile']").inputValue();
    let held = false;
    await peer.page.route("**/settings**", async route => {
      const request = route.request();
      if (!held && request.method() === "GET" && new URL(request.url()).pathname === "/settings" && request.headers().rsc === "1") {
        held = true;
        await gate;
      }
      await route.continue();
    });

    await page.goto("/settings");
    await page.locator("#studio-name").fill("Latest studio identity from other device");
    await page.locator(".studio-settings-form button[type='submit']").click();
    await expect(page.locator(".studio-settings-form .settings-success")).toBeVisible();
    await expect.poll(() => held).toBe(true);
    await peer.page.locator("#studio-name").fill("My draft entered while updates load");

    const sync = peer.page.locator(".workspace-sync-status");
    await expect(sync).toHaveAttribute("data-state", "error", { timeout: 25_000 });
    await expect(sync).toContainText("Loading updates is taking too long. Your unsaved edits are kept.");
    await expect(sync.getByRole("button", { name: "Review updates", exact: true })).toBeVisible();
    const pollsAtFailure = healthyPolls;
    await expect.poll(() => healthyPolls).toBeGreaterThanOrEqual(pollsAtFailure + 2);
    await expect(sync).toHaveAttribute("data-state", "error");
    await expect(sync).toContainText("Loading updates is taking too long.");
    await expect(peer.page.locator("#studio-name")).toHaveValue("My draft entered while updates load");

    release();
    await expect(peer.page.locator(".topbar-app-name")).toHaveText("Latest studio identity from other device");
    await expect(peer.page.locator("#studio-name")).toHaveValue("My draft entered while updates load");
    await expect(peer.page.locator("input[name='expectedProfile']")).toHaveValue(originalBaseline);
    await peer.page.locator(".studio-settings-form button[type='submit']").click();
    await expect(peer.page.locator(".studio-settings-form [data-sync-conflict]")).toContainText("This record changed on another device.");
    await expect(peer.page.locator("#studio-name")).toHaveValue("My draft entered while updates load");
    const profile = await withTestDatabase(pool => pool.query('SELECT "studioName" FROM "user" WHERE email=$1', ["owner@example.com"]));
    expect(profile.rows).toEqual([{ studioName: "Latest studio identity from other device" }]);
  } finally {
    release();
    await peer.page.unrouteAll({ behavior: "wait" });
    await peer.context.close();
  }
});

test("sync exposes only a private revision and an expired device session clears its private view", async ({ page, browser }, testInfo) => {
  await signUp(page);
  const clientPath = await createClient(page, "Private sync client");
  const designId = await uploadArtwork(page, "Private sync artwork");
  const peer = await openPeer(browser, testInfo);
  const visitor = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) });
  try {
    const response = await peer.page.request.get("/api/workspace/sync");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["workspaceId", "revision", "diagnosticsConsent"]);
    expect(body.diagnosticsConsent).toBe(false);
    expect(body.workspaceId).toEqual(expect.any(String));
    expect(body.revision).toMatch(/^\d+$/);
    const queried = await peer.page.request.get("/api/workspace/sync?artistId=someone-else");
    expect(await queried.json()).toEqual(body);
    expect((await visitor.request.get("/api/workspace/sync")).status()).toBe(401);
    expect((await visitor.request.get(`/api/designs/${designId}/image?variant=preview`)).status()).toBe(401);

    await peer.page.goto(`${clientPath}/edit`);
    await peer.page.locator("#client-notes").fill("Private unsaved draft on the expired device");
    // Expire only this independently created disposable session; never read tokens.
    await withTestDatabase(pool => pool.query('UPDATE "session" SET "expiresAt"=(now() AT TIME ZONE \'UTC\') - interval \'1 minute\' WHERE id=$1', [peer.sessionId]));
    await expect(peer.page).toHaveURL(url => url.pathname === "/sign-in");
    await expect(peer.page.locator(".app-shell")).toHaveCount(0);
    await expect(peer.page.locator("body")).not.toContainText("Private sync client");
    await expect(peer.page.locator("body")).not.toContainText("Private unsaved draft on the expired device");
    expect((await peer.page.request.get("/api/workspace/sync")).status()).toBe(401);
    expect((await page.request.get("/api/workspace/sync")).status()).toBe(200);
  } finally { await peer.context.close(); await visitor.close(); }
});
