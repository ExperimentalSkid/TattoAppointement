import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fillAppointmentStart, revealAppointmentMoney } from "./appointment-helpers";

const origin = "http://127.0.0.1:3000";
const password = "PrivateArtistWorkspace-2026!";
const artistA = { name: "Artist A", email: "artist-a@example.com", password };
const artistB = { name: "Artist B", email: "artist-b@example.com", password };
let signInAttempt = 0;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function register(context: BrowserContext, artist: typeof artistA) {
  const response = await context.request.post("/api/auth/sign-up/email", { headers: { origin }, data: artist });
  expect(response.status()).toBe(200);
  expect((await context.request.post("/api/preferences/language", { headers: { origin }, data: { language: "en" } })).status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function signIn(context: BrowserContext, artist: typeof artistA) {
  // The authorization suite deliberately changes accounts many times. Give
  // each simulated device login its own test IP; production limits stay active.
  const address = `10.72.${Math.floor(signInAttempt / 250) + 1}.${signInAttempt % 250 + 1}`;
  signInAttempt += 1;
  const response = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin, "x-forwarded-for": address }, data: { email: artist.email, password },
  });
  expect(response.status()).toBe(200);
}

async function exportData(context: BrowserContext) {
  const response = await context.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
  return response.json();
}

async function revision(context: BrowserContext) {
  const response = await context.request.get("/api/workspace/sync");
  expect(response.status()).toBe(200);
  return response.json();
}

async function createClient(page: Page, label: string) {
  await page.goto("/clients/new");
  await page.locator("#client-name").fill(label);
  // Artists may tattoo the same person; duplicate checks must remain per workspace.
  await page.locator("#client-phone").fill("+34611007800");
  await page.locator("#client-notes").fill(`${label} private placement notes`);
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function artwork(page: Page, title: string) {
  const response = await page.request.post("/api/designs", {
    multipart: { title, notes: `${title} private stencil`, image: { name: "private.png", mimeType: "image/png", buffer: png } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

async function appointment(page: Page, designId: string, label: string) {
  await page.goto("/new-appointment?date=2026-11-08");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  // Independent artists can book exactly the same time without a false overlap.
  await fillAppointmentStart(page, "2026-11-08T10:00");
  await page.locator(`input[name='designIds'][value='${designId}']`).check();
  await page.locator("#appointment-notes").fill(`${label} private appointment`);
  await revealAppointmentMoney(page);
  await page.locator("#agreed-price").fill("200.00");
  await page.locator("#deposit-required").fill("50.00");
  await page.locator("#initial-payment").fill("25.00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function studio(page: Page, name: string) {
  await page.goto("/settings");
  await page.locator("#studio-name").fill(name);
  await page.locator(".studio-settings-form button[type='submit']").click();
  await expect(page.locator(".studio-settings-form .settings-success")).toBeVisible();
  const reminder = `${name}: {client}, tattoo on {date} at {time}.`;
  await page.locator("#whatsapp-reminder-template").fill(reminder);
  await page.locator(".reminder-settings-form button[type='submit']").click();
  await expect(page.locator(".reminder-settings-form .settings-success")).toBeVisible();
  return reminder;
}

test("artists have separate clients, artwork, bookings, money, preferences, exports and sync", async ({ page, browser }, testInfo) => {
  const firstContext = page.context();
  const firstId = await register(firstContext, artistA);
  const firstClient = await createClient(page, "Artist A client");
  const firstDesign = await artwork(page, "Artist A artwork");
  const firstAppointment = await appointment(page, firstDesign, "Artist A");
  const firstReminder = await studio(page, "Atelier A");
  const other = await browser.newContext({ baseURL: origin, timezoneId: "Europe/Madrid", extraHTTPHeaders: { "x-forwarded-for": "10.71.0.2" } });
  const peer = await browser.newContext({ baseURL: origin, timezoneId: "Europe/Madrid", extraHTTPHeaders: { "x-forwarded-for": "10.71.0.3" } });
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const otherId = await register(other, artistB);
    expect(otherId).not.toBe(firstId);
    const otherPage = await other.newPage();
    await otherPage.goto("/clients");
    await expect(otherPage.locator(".client-list-item")).toHaveCount(0);
    await otherPage.goto("/designs");
    await expect(otherPage.locator(".design-card")).toHaveCount(0);
    await otherPage.goto("/calendar?view=day&anchor=2026-11-08");
    await expect(otherPage.locator(".calendar-session-count strong")).toHaveText("00");
    const secondClient = await createClient(otherPage, "Artist B client");
    const secondDesign = await artwork(otherPage, "Artist B artwork");
    const secondAppointment = await appointment(otherPage, secondDesign, "Artist B");
    const secondReminder = await studio(otherPage, "Atelier B");

    const firstExport = await exportData(firstContext);
    const secondExport = await exportData(other);
    expect(firstExport.profile).toMatchObject({ id: firstId, email: artistA.email, studioName: "Atelier A", whatsappReminderTemplate: firstReminder, language: "en" });
    expect(secondExport.profile).toMatchObject({ id: otherId, email: artistB.email, studioName: "Atelier B", whatsappReminderTemplate: secondReminder, language: "en" });
    for (const [data, id, clientPath, designId, appointmentPath] of [
      [firstExport, firstId, firstClient, firstDesign, firstAppointment],
      [secondExport, otherId, secondClient, secondDesign, secondAppointment],
    ] as const) {
      expect(data.clients).toHaveLength(1);
      expect(data.clients[0]).toMatchObject({ id: clientPath.split("/").at(-1), artistId: id });
      expect(data.designs).toHaveLength(1);
      expect(data.designs[0].id).toBe(designId);
      expect(data.appointments).toHaveLength(1);
      expect(data.appointments[0]).toMatchObject({ id: appointmentPath.split("/").at(-1), artistId: id, designs: [{ designId, isFinal: false }] });
      expect(data.payments).toHaveLength(1);
      expect(data.payments[0]).toMatchObject({ artistId: id, appointmentId: appointmentPath.split("/").at(-1), amount: "25" });
      for (const credential of ["password", "accessToken", "refreshToken"]) expect(data.profile).not.toHaveProperty(credential);
    }
    for (const path of [firstClient, `${firstClient}/edit`, `/designs/${firstDesign}`, `/designs/${firstDesign}/edit`, firstAppointment, `${firstAppointment}/edit`]) {
      expect((await otherPage.goto(path))?.status(), "Another artist's record remains private").toBe(404);
    }
    for (const variant of ["preview", "original"]) {
      expect((await other.request.get(`/api/designs/${firstDesign}/image?variant=${variant}`)).status()).toBe(404);
      expect((await firstContext.request.get(`/api/designs/${secondDesign}/image?variant=${variant}`)).status()).toBe(404);
      expect((await firstContext.request.get(`/api/designs/${firstDesign}/image?variant=${variant}`)).status()).toBe(200);
      expect((await visitor.request.get(`/api/designs/${firstDesign}/image?variant=${variant}`)).status()).toBe(401);
    }
    await otherPage.goto("/new-appointment");
    await expect(otherPage.locator(`#appointment-client option[value='${firstClient.split("/").at(-1)}']`)).toHaveCount(0);
    await expect(otherPage.locator(`input[name='designIds'][value='${firstDesign}']`)).toHaveCount(0);
    await expect(otherPage.locator(`#appointment-client option[value='${secondClient.split("/").at(-1)}']`)).toHaveCount(1);
    await expect(otherPage.locator(`input[name='designIds'][value='${secondDesign}']`)).toHaveCount(1);
    const ownRevision = await revision(other);
    expect(ownRevision.workspaceId).toBe(otherId);
    expect(await (await other.request.get(`/api/workspace/sync?artistId=${firstId}`)).json()).toEqual(ownRevision);

    await signIn(peer, artistA);
    const peerPage = await peer.newPage();
    await peerPage.goto("/clients?q=Artist");
    await otherPage.goto("/clients");
    const otherRevisionBefore = await revision(other);
    await page.goto(`${firstClient}/edit`);
    await page.locator("#client-name").fill("Artist A saved on laptop");
    await page.locator(".client-form button[type='submit']").click();
    await page.waitForURL(url => url.pathname === firstClient);
    await expect(peerPage.locator(`.client-list-item[href^='${firstClient}']`)).toContainText("Artist A saved on laptop");
    await expect(peerPage.locator(`.client-list-item[href^='${secondClient}']`)).toHaveCount(0);
    await expect(otherPage.locator(".client-list-item")).toHaveCount(1);
    await expect(otherPage.locator(".client-list-item")).toContainText("Artist B client");
    expect(await revision(other)).toEqual(otherRevisionBefore);
    expect((await revision(peer)).workspaceId).toBe(firstId);
    await peerPage.screenshot({ path: testInfo.outputPath("independent-artist-workspace.png"), fullPage: true });

    const firstRevisionBefore = await revision(firstContext);
    await otherPage.goto("/settings");
    await otherPage.locator(".app-topbar .language-select").selectOption("es");
    await expect(otherPage.locator(".app-topbar .language-select")).toHaveValue("es");
    expect(await revision(firstContext)).toEqual(firstRevisionBefore);
    await page.goto("/settings");
    await expect(page.locator(".topbar-app-name")).toHaveText("Atelier A");
    await expect(page.locator("#whatsapp-reminder-template")).toHaveValue(firstReminder);
    await expect(page.locator(".app-topbar .language-select")).toHaveValue("en");
    const finalSecond = await exportData(other);
    expect(finalSecond.profile).toMatchObject({ studioName: "Atelier B", whatsappReminderTemplate: secondReminder, language: "es" });
  } finally { await Promise.all([other.close(), peer.close(), visitor.close()]); }
});

test("forms rendered for one artist cannot change their records after another artist signs in", async ({ page, browser }) => {
  const context = page.context();
  await register(context, artistA);
  const clientPath = await createClient(page, "Artist A protected client");
  const designId = await artwork(page, "Artist A protected artwork");
  const appointmentPath = await appointment(page, designId, "Artist A protected");
  const second = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.72.0.2" } });
  try {
    await register(second, artistB);
    const baseline = await exportData(context);
    // Keep the already-rendered fixture available long enough to exercise the
    // server's ownership checks independently of automatic account-switch clearing.
    // Suspend polling rather than returning an artist identity that becomes
    // incorrect once a guarded action renders the newly signed-in artist's shell.
    await page.route("**/api/workspace/sync", route => route.request().method() === "GET" ? route.abort("failed") : route.continue());
    const submitAsOtherArtist = async (path: string, prepare: () => Promise<void>, button: () => Locator, confirm = false) => {
      await signIn(context, artistA);
      await page.goto(path);
      await prepare();
      await signIn(context, artistB);
      if (confirm) page.once("dialog", dialog => dialog.accept());
      const result = page.waitForResponse(response => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
      await button().click();
      expect((await result).status()).toBeLessThan(500);
    };
    await submitAsOtherArtist(`${clientPath}/edit`, async () => { await page.locator("#client-name").fill("Attempted replacement"); },
      () => page.locator(".client-form button[type='submit']"));
    await submitAsOtherArtist(`/designs/${designId}/edit`, async () => { await page.locator("#design-title").fill("Attempted stencil replacement"); },
      () => page.getByRole("button", { name: "Save changes", exact: true }));
    await submitAsOtherArtist(`${appointmentPath}/edit`, async () => { await page.locator("#appointment-notes").fill("Attempted appointment replacement"); },
      () => page.locator(".appointment-form button[type='submit']"));
    await submitAsOtherArtist(appointmentPath, async () => { await page.locator("#payment-amount").fill("99.00"); },
      () => page.locator(".payment-entry-form button[type='submit']"));
    await submitAsOtherArtist(appointmentPath, async () => {}, () => page.getByRole("button", { name: "Remove payment", exact: true }), true);
    await submitAsOtherArtist(appointmentPath, async () => {}, () => page.getByRole("button", { name: "Cancel appointment", exact: true }), true);
    await submitAsOtherArtist(`/designs/${designId}/edit`, async () => {}, () => page.getByRole("button", { name: "Delete design", exact: true }), true);
    await submitAsOtherArtist(appointmentPath, async () => {}, () => page.getByRole("button", { name: "Delete appointment", exact: true }), true);

    await signIn(context, artistA);
    const retained = await exportData(context);
    for (const field of ["profile", "clients", "designs", "appointments", "payments"]) expect(retained[field]).toEqual(baseline[field]);
    expect((await context.request.get(`/api/designs/${designId}/image?variant=original`)).status()).toBe(200);
    const secondExport = await exportData(second);
    for (const field of ["clients", "designs", "appointments", "payments"]) expect(secondExport[field]).toEqual([]);
  } finally { await second.close(); }
});

test("switching accounts in another tab clears the old artist's private draft even when workspace revisions match", async ({ page, browser }) => {
  const context = page.context();
  const firstId = await register(context, artistA);
  const firstClient = await createClient(page, "Artist A confidential client");
  const second = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.73.0.2" } });
  try {
    const secondId = await register(second, artistB);
    const secondPage = await second.newPage();
    await createClient(secondPage, "Artist B own client");
    expect((await revision(context)).revision).toBe((await revision(second)).revision);
    await page.goto(`${firstClient}/edit`);
    await page.locator("#client-notes").fill("Artist A confidential unsaved draft");
    await expect(page.locator(".client-form")).toHaveAttribute("data-sync-dirty", "true");
    const anotherTab = await context.newPage();
    await signIn(context, artistB);
    await anotherTab.goto("/calendar");
    await expect(anotherTab.locator(".app-shell")).toBeVisible();
    await expect(page).toHaveURL(url => url.pathname === "/calendar");
    await expect(page.locator("main")).not.toContainText("Artist A confidential client");
    await expect(page.locator("body")).not.toContainText("Artist A confidential unsaved draft");
    await expect(page.locator(".client-form")).toHaveCount(0);
    expect((await revision(context)).workspaceId).toBe(secondId);
    expect(secondId).not.toBe(firstId);
    await page.goto("/clients");
    await expect(page.locator(".client-list-item")).toHaveCount(1);
    await expect(page.locator(".client-list-item")).toContainText("Artist B own client");
    await signIn(context, artistA);
    await page.goto(firstClient);
    await expect(page.locator("main")).toContainText("Artist A confidential client");
    await expect(page.locator("main")).not.toContainText("Artist A confidential unsaved draft");
  } finally { await second.close(); }
});
