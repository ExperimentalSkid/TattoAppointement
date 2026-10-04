import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fillAppointmentStart, revealAppointmentMoney } from "./appointment-helpers";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const email = "new-artist-journey@example.com";
const password = "NewArtistJourney-2026!";
const newPassword = "ChangedArtistJourney-2026!";

async function saveBooking(page: Page) {
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

test("one new artist completes the studio, client, artwork, booking, money, history and account journey through the UI", async ({ page, browser }, testInfo) => {
  const pageErrors: string[] = [];
  const requestErrors: string[] = [];
  const deletedResources = new Set<string>();
  let signedOut = true;
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    const expectedLogout = signedOut && response.status() === 401 && path === "/api/workspace/sync";
    const expectedDeleted = response.status() === 404 && [...deletedResources].some(resource => path === resource || path.startsWith(`${resource}/`));
    if (response.status() >= 400 && !expectedLogout && !expectedDeleted) requestErrors.push(`${response.status()} ${response.request().method()} ${path}`);
  });
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText ?? "unknown failure";
    if (!reason.includes("ERR_ABORTED")) requestErrors.push(`${request.method()} ${new URL(request.url()).pathname}: ${reason}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Nerea Tattoo");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  signedOut = false;
  await expect(page.locator(".calendar-session-count strong")).toHaveText("00");
  for (const [path, selector] of [["/clients", ".client-list-item"], ["/designs", ".design-card"]]) {
    await page.goto(path);
    await expect(page.locator(selector)).toHaveCount(0);
  }

  await page.goto("/settings");
  await page.locator("#artist-name").fill("Nerea Sol");
  await page.locator("#studio-name").fill("Taller Origen");
  await page.locator(".studio-settings-form button[type='submit']").click();
  await expect(page.locator(".studio-settings-form .settings-success")).toBeVisible();
  const template = "Hi {client}, your tattoo at {studio} is on {date}, {time}.";
  await page.locator("#whatsapp-reminder-template").fill(template);
  await page.locator(".reminder-settings-form button[type='submit']").click();
  await expect(page.locator(".reminder-settings-form .settings-success")).toBeVisible();
  for (const language of ["es", "en"]) {
    await page.locator(".app-topbar .language-select").selectOption(language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
  }
  await page.reload();
  await expect(page.locator("#studio-name")).toHaveValue("Taller Origen");
  await expect(page.locator("#whatsapp-reminder-template")).toHaveValue(template);

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("María");
  await page.locator("#client-phone").fill("+34 611 000 988");
  await page.locator("#client-email").fill("maria-client@example.test");
  await page.locator("#client-notes").fill("Left forearm placement");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientPath = new URL(page.url()).pathname;
  const clientId = clientPath.split("/").at(-1)!;
  await page.goto(`${clientPath}/edit`);
  await page.locator("#client-name").fill("María Sol");
  await page.locator("#client-notes").fill("Left forearm placement\nKeep the fine lines.");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === clientPath);
  await page.goto("/clients");
  await page.locator(".client-search input[name='q']").fill("María Sol");
  await page.locator(".client-search button[type='submit']").click();
  await expect(page.locator(".client-list-item")).toHaveCount(1);
  await expect(page.locator(".client-list-item")).toContainText("María Sol");

  await page.goto("/designs/new");
  await page.locator("#design-image").setInputFiles({ name: "journey-artwork.png", mimeType: "image/png", buffer: png });
  await page.locator("#design-title").fill("Olive branch");
  await page.locator("#design-notes").fill("Original forearm stencil");
  await page.locator(".design-form button[type='submit']").click();
  await page.waitForURL(/\/designs\/(?!new$)[A-Za-z0-9_-]+$/);
  const designPath = new URL(page.url()).pathname;
  const designId = designPath.split("/").at(-1)!;
  await page.locator(".design-preview-button").click();
  await expect(page.locator(".design-dialog")).toBeVisible();
  await expect(page.locator(".design-dialog-image-wrap")).toHaveAttribute("data-state", "loaded");
  await page.locator(".design-dialog-close").click();
  await page.goto(`${designPath}/edit`);
  await page.locator("#design-title").fill("Olive branch final");
  await page.locator("#design-notes").fill("Fine line final stencil");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForURL(url => url.pathname === designPath);
  await page.goto("/designs");
  await page.locator(".search-bar input[name='q']").fill("Olive branch final");
  await page.locator(".search-bar button[type='submit']").click();
  await expect(page.locator(".design-card")).toHaveCount(1);

  const year = new Date().getUTCFullYear() + 1;
  const originalDate = `${year}-11-05`;
  const movedDate = `${year}-11-06`;
  const notes = "Tattoo placement and final stencil agreed with María.";
  await page.goto(`/calendar?view=day&anchor=${originalDate}`);
  await page.locator(".calendar-navigation button").first().click();
  await expect(page).toHaveURL(url => url.searchParams.get("anchor") === `${year}-11-04`);
  await page.locator(".calendar-navigation button").last().click();
  await expect(page).toHaveURL(url => url.searchParams.get("anchor") === originalDate);
  await page.locator(".calendar-navigation").getByRole("button", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("anchor") !== originalDate);
  await page.locator(".calendar-date-jump input").fill(originalDate);
  await expect(page).toHaveURL(url => url.searchParams.get("anchor") === originalDate);
  await page.locator(".calendar-new-button").click();
  await expect(page.locator("#appointment-date")).toHaveValue(originalDate);
  await page.locator("#appointment-client").selectOption(clientId);
  await fillAppointmentStart(page, `${originalDate}T10:00`);
  await page.locator(`input[name='designIds'][value='${designId}']`).check();
  await page.locator(`input[name='finalDesignId'][value='${designId}']`).check();
  await page.locator("#appointment-notes").fill(notes);
  await revealAppointmentMoney(page);
  await page.locator("#agreed-price").fill("350.00");
  await page.locator("#deposit-required").fill("100.00");
  await page.locator("#initial-payment").fill("50.00");
  const appointmentPath = await saveBooking(page);
  await expect(page.locator(".appointment-design-gallery")).toContainText("Olive branch final");
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  await page.locator("#reschedule-date").fill(movedDate);
  await page.locator("#reschedule-time").fill("15:00");
  await page.locator(".appointment-reschedule-form button[type='submit']").click();
  await expect(page.locator(".appointment-record-meta > time")).toHaveAttribute("datetime", `${movedDate}T14:00:00.000Z`);
  await page.goto(`${appointmentPath}/edit`);
  await page.locator("#appointment-status").selectOption("CONFIRMED");
  await saveBooking(page);
  const reminder = new URL((await page.locator("a[href^='https://wa.me/']").getAttribute("href"))!);
  expect(reminder.pathname).toBe("/34611000988");
  expect(reminder.searchParams.get("text")).toBe(`Hi María Sol, your tattoo at Taller Origen is on 6 November ${year}, 15:00.`);
  await page.locator("#payment-amount").fill("25.00");
  await page.locator(".payment-entry-form button[type='submit']").click();
  await expect(page.locator(".payment-history-list li")).toHaveCount(2);
  const paymentToRemove = page.locator(".payment-history-list li").filter({ has: page.locator(".payment-history-entry strong", { hasText: /^€\s*25\.00$/ }) });
  await expect(paymentToRemove).toHaveCount(1);
  page.once("dialog", async dialog => {
    expect(dialog.message()).toMatch(/25\.00/);
    await dialog.accept();
  });
  await paymentToRemove.getByRole("button", { name: "Remove payment", exact: true }).click();
  await expect(page.locator(".payment-history-list li")).toHaveCount(1);
  await expect(page.locator(".payment-history-entry strong")).toHaveText(/^€\s*50\.00$/);
  await page.locator("#payment-amount").fill("50.00");
  await page.locator(".payment-entry-form button[type='submit']").click();
  await expect(page.locator(".payment-history-list li")).toHaveCount(2);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ["day", "week", "month"]) {
      await page.goto(`/calendar?view=${view}&anchor=${movedDate}`);
      await expect(page.locator(`.calendar-page a[href='${appointmentPath}']:visible`)).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  }

  await page.goto(`${appointmentPath}/edit`);
  await page.locator("#appointment-status").selectOption("COMPLETED");
  await saveBooking(page);
  await expect(page.locator("a[href^='https://wa.me/']")).toHaveCount(0);
  await page.goto(`/new-appointment?date=${originalDate}`);
  await page.locator("#appointment-client").selectOption(clientId);
  await fillAppointmentStart(page, `${originalDate}T10:00`);
  await page.locator("#appointment-notes").fill("Booking to cancel");
  const cancelledPath = await saveBooking(page);
  await page.goto(`${cancelledPath}/edit`);
  await page.locator("#appointment-status").selectOption("NO_SHOW");
  await saveBooking(page);
  await expect(page.locator(".appointment-detail-header [data-status='NO_SHOW']")).toBeVisible();
  await page.goto(`${cancelledPath}/edit`);
  await page.locator("#appointment-status").selectOption("PLANNED");
  await saveBooking(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(page.locator(".appointment-detail-header [data-status='CANCELLED']")).toBeVisible();
  await page.goto(`/calendar?view=month&anchor=${originalDate}`);
  await expect(page.locator(`.calendar-page a[href='${cancelledPath}']`)).toHaveCount(0);
  await page.goto(clientPath);
  await expect(page.locator(`.appointment-history a[href='${cancelledPath}']`)).toBeVisible();
  await page.goto(cancelledPath);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete appointment", exact: true }).click();
  await page.waitForURL(url => url.pathname === clientPath);
  await expect(page.locator(`.appointment-history a[href='${cancelledPath}']`)).toHaveCount(0);

  await page.goto("/settings");
  const downloadReady = page.waitForEvent("download");
  await page.locator(".account-export-button").click();
  const download = await downloadReady;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.profile).toMatchObject({ name: "Nerea Sol", email, studioName: "Taller Origen", language: "en", whatsappReminderTemplate: template });
  expect(exported.clients).toHaveLength(1);
  expect(exported.designs).toHaveLength(1);
  expect(exported.appointments).toHaveLength(1);
  expect(exported.appointments[0]).toMatchObject({ id: appointmentPath.split("/").at(-1), status: "COMPLETED", notes, designs: [{ designId, isFinal: true }] });
  expect(exported.payments).toHaveLength(2);
  expect(exported.payments.map((payment: { amount: string }) => payment.amount)).toEqual(["50", "50"]);
  for (const key of ["password", "accounts", "sessions", "accessToken"]) expect(exported.profile).not.toHaveProperty(key);
  await page.locator("#current-password").fill(password);
  await page.locator("#new-password").fill(newPassword);
  await page.locator("#confirm-password").fill(newPassword);
  await page.locator(".password-settings-form button[type='submit']").click();
  await expect(page.locator(".password-settings-form .settings-success")).toBeVisible();
  for (const field of ["#current-password", "#new-password", "#confirm-password"]) {
    await expect.soft(page.locator(field), "Successful password changes should clear sensitive values and their draft state").toHaveValue("", { timeout: 1_000 });
  }
  const peer = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), extraHTTPHeaders: { "x-forwarded-for": "10.82.0.2" } });
  try {
    const peerPage = await peer.newPage();
    await peerPage.goto("/sign-in");
    if (!(await peerPage.locator("#email").isVisible())) await peerPage.locator(".auth-email-option > summary").click();
    await peerPage.locator("#email").fill(email);
    await peerPage.locator("#password").fill(newPassword);
    await peerPage.locator(".auth-form button[type='submit']").click();
    await peerPage.waitForURL(url => url.pathname === "/calendar");
    await peerPage.goto("/settings");
    await peerPage.locator("#studio-name").fill("Taller Origen updated");
    await peerPage.locator(".studio-settings-form button[type='submit']").click();
    await expect(peerPage.locator(".studio-settings-form .settings-success")).toBeVisible();
    await expect.soft(page.locator(".topbar-app-name"), "A saved password form must not block the other device's saved studio update").toHaveText("Taller Origen updated", { timeout: 5_000 });
    // Continue the rest of the journey even when the soft checks find retained
    // password values. Clearing these fixture inputs represents the artist's edit.
    for (const field of ["#current-password", "#new-password", "#confirm-password"]) await page.locator(field).fill("");
    await page.locator("#confirm-password").blur();
    await expect(page.locator(".topbar-app-name")).toHaveText("Taller Origen updated");
  } finally { await peer.close(); }
  signedOut = true;
  await page.locator(".signout-button:visible").click();
  await page.waitForURL(url => url.pathname === "/sign-in");
  if (!(await page.locator("#email").isVisible())) await page.locator(".auth-email-option > summary").click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(newPassword);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  signedOut = false;
  await page.goto(appointmentPath);
  await expect(page.locator(".appointment-notes")).toHaveText(notes);
  await expect(page.locator(".payment-history-list li")).toHaveCount(2);
  const moneyBefore = await page.locator(".money-summary-grid").innerText();
  await page.goto(`${designPath}/edit`);
  deletedResources.add(designPath);
  deletedResources.add(`/api/designs/${designId}/image`);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete design", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/designs");
  await expect(page.locator(".design-card")).toHaveCount(0);
  await page.goto(appointmentPath);
  await expect(page.locator(".appointment-notes")).toHaveText(notes);
  await expect(page.locator(".money-summary-grid")).toHaveText(moneyBefore, { useInnerText: true });
  await expect(page.locator(".payment-history-list li")).toHaveCount(2);
  await expect(page.locator(".appointment-design-gallery")).toHaveCount(0);
  await page.goto(clientPath);
  await expect(page.locator(`.appointment-history a[href='${appointmentPath}']`)).toBeVisible();
  await testInfo.attach("Unexpected browser errors", { body: JSON.stringify({ pageErrors, requestErrors }, null, 2), contentType: "application/json" });
  expect(pageErrors).toEqual([]);
  expect(requestErrors).toEqual([]);
});
