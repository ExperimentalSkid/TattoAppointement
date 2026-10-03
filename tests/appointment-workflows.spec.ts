import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { Pool } from "pg";

test.use({ timezoneId: "America/New_York" });

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Appointment workflow fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function signUp(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Appointment workflow artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Appointment-Workflow-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar/);
}

async function submitAndSettle(page: Page, formSelector: string) {
  const submit = page.locator(`${formSelector} button[type='submit']`);
  const path = new URL(page.url()).pathname;
  await Promise.all([
    page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === path),
    submit.click(),
  ]);
  await expect(submit).toBeEnabled();
}

async function assertAssociatedError(page: Page, selector: string) {
  const field = page.locator(selector);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(await field.evaluate(element => {
    const ids = element.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
    return ids.some(id => {
      const description = document.getElementById(id);
      return Boolean(description?.classList.contains("form-error") && description.textContent?.trim());
    });
  })).toBe(true);
}

async function uploadArtwork(page: Page) {
  const response = await page.request.post("/api/designs", {
    multipart: { title: "Workflow reference", image: { name: "workflow.png", mimeType: "image/png", buffer: png } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

async function appointmentRecord(id: string) {
  return withTestDatabase(async pool => {
    const record = await pool.query<{ id: string; clientId: string; startsAt: string; durationMinutes: number; notes: string; status: string; agreedPrice: string; depositRequired: string }>(
      'SELECT id,"clientId",to_char("startsAt",\'YYYY-MM-DD"T"HH24:MI\') AS "startsAt","durationMinutes",notes,status,"agreedPrice","depositRequired" FROM "Appointment" WHERE id=$1', [id],
    );
    expect(record.rows).toHaveLength(1);
    const designs = await pool.query<{ designId: string; isFinal: boolean }>('SELECT "designId","isFinal" FROM "AppointmentDesign" WHERE "appointmentId"=$1 ORDER BY "designId"', [id]);
    const payments = await pool.query<{ id: string; amount: string }>('SELECT id,amount FROM "Payment" WHERE "appointmentId"=$1 ORDER BY id', [id]);
    return { ...record.rows[0], designs: designs.rows, payments: payments.rows };
  });
}

async function seedAppointment(id: string, name: string, startsAtIso: string, status = "PLANNED", designId?: string) {
  await withTestDatabase(async pool => {
    const owner = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    const artistId = owner.rows[0].id;
    const clientId = `${id}-client`;
    await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', [clientId, artistId, name, "+34611000600"]);
    // ISO strings keep Prisma's UTC timestamp representation independent of Windows host time.
    await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",notes,status,"agreedPrice","depositRequired","updatedAt") VALUES ($1,$2,$3,$4,120,$5,$6::"AppointmentStatus",350,100,now())', [id, artistId, clientId, startsAtIso, "Preserve tattoo placement notes", status]);
    await pool.query('INSERT INTO "Payment" (id,"artistId","appointmentId",amount) VALUES ($1,$2,$3,50)', [`${id}-payment`, artistId, id]);
    if (designId) await pool.query('INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") VALUES ($1,$2,true)', [id, designId]);
  });
}

test("booking accepts optional artwork, explains server validation and remains editable after the final reference is deleted", async ({ page }) => {
  await signUp(page);
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Booking workflow client");
  await page.locator("#client-phone").fill("+34 611 000 600");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  await page.goto("/new-appointment?date=2026-11-05");
  await page.locator("#appointment-notes").fill("Keep this draft while correcting errors");
  await page.locator(".appointment-form").evaluate(form => { (form as HTMLFormElement).noValidate = true; });
  await submitAndSettle(page, ".appointment-form");
  await assertAssociatedError(page, "#appointment-client");
  await assertAssociatedError(page, "#appointment-time");
  await expect(page.locator(".appointment-form-feedback")).toBeFocused();
  await expect(page.locator("#appointment-notes")).toHaveValue("Keep this draft while correcting errors");
  await expect(page.locator("#appointment-date")).toHaveValue("2026-11-05");

  await page.locator("#appointment-client").selectOption({ index: 1 });
  await page.locator("#appointment-time").fill("10:00");
  await page.locator(".appointment-money-disclosure summary").click();
  await page.locator("#agreed-price").fill("350.00");
  await page.locator("#deposit-required").fill("100.00");
  await page.locator("#initial-payment").fill("50.00");
  await expect(page.locator("#appointment-notes")).toHaveAttribute("maxlength", "5000");
  // QA intentionally exceeds the browser limit to exercise the server boundary.
  await page.locator("#appointment-notes").evaluate(element => { (element as HTMLTextAreaElement).maxLength = 6000; });
  await page.locator("#appointment-notes").fill("x".repeat(5001));
  await submitAndSettle(page, ".appointment-form");
  await assertAssociatedError(page, "#appointment-notes");
  await expect(page.locator("#appointment-notes")).toHaveValue("x".repeat(5001));
  await expect(page.locator("#agreed-price")).toHaveValue("350.00");
  await expect(page.locator("#appointment-time")).toHaveValue("10:00");
  await expect(page).toHaveURL(url => url.pathname === "/new-appointment" && url.searchParams.get("date") === "2026-11-05");

  await page.locator("#appointment-notes").fill("x".repeat(5000));
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const appointmentPath = new URL(page.url()).pathname;
  const id = appointmentPath.split("/").pop()!;
  const original = await appointmentRecord(id);
  expect(original.notes).toHaveLength(5000);
  expect(original.designs).toEqual([]);
  expect(original.payments).toEqual([{ id: expect.any(String), amount: "50.00" }]);

  const designId = await uploadArtwork(page);
  await page.goto(`${appointmentPath}/edit`);
  await page.locator(`input[name='designIds'][value='${designId}']`).check();
  await page.locator(`input[name='finalDesignId'][value='${designId}']`).check();
  await page.locator("#appointment-notes").fill("Tattoo notes retained when reference is deleted");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === appointmentPath);
  await page.goto(`/designs/${designId}/edit`);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete design", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/designs");
  await page.goto(`${appointmentPath}/edit`);
  await expect(page.locator("input[name='designIds']")).toHaveCount(0);
  await expect(page.locator("#appointment-notes")).toHaveValue("Tattoo notes retained when reference is deleted");
  await expect(page.locator("#appointment-date")).toHaveValue("2026-11-05");
  await expect(page.locator("#appointment-time")).toHaveValue("10:00");
  await page.locator("#appointment-status").selectOption("CONFIRMED");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === appointmentPath);
  const edited = await appointmentRecord(id);
  expect(edited).toMatchObject({ status: "CONFIRMED", notes: "Tattoo notes retained when reference is deleted", agreedPrice: "350.00", depositRequired: "100.00", designs: [], payments: original.payments });
});

test("focused rescheduling exposes conflicts, resets acknowledgments and rejects invalid Madrid clock changes without altering the record", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signUp(page);
  const designId = await uploadArtwork(page);
  await seedAppointment("reschedule-source", "Reschedule workflow client", "2026-11-02T09:00:00.000Z", "CONFIRMED", designId);
  await seedAppointment("reschedule-conflict", "Already booked tattoo client", "2026-11-03T09:30:00.000Z");
  const original = await appointmentRecord("reschedule-source");
  await page.goto("/calendar?view=day&anchor=2026-11-02");
  const rescheduleLink = page.locator(".calendar-card-actions a[href='/appointments/reschedule-source?reschedule=1#appointment-reschedule-form']");
  await expect(rescheduleLink).toHaveText("Reschedule");
  await rescheduleLink.click();
  await expect(page).toHaveURL(url => url.pathname === "/appointments/reschedule-source" && url.searchParams.get("reschedule") === "1" && url.hash === "#appointment-reschedule-form");
  await expect(page.locator(".appointment-detail-header [data-status='CONFIRMED']")).toBeVisible();
  await expect(page.locator(".appointment-reschedule-form")).toBeVisible();
  await expect(page.locator("#reschedule-date")).toHaveValue("2026-11-02");
  await expect(page.locator("#reschedule-time")).toHaveValue("10:00");
  await expect(page.locator(".appointment-form")).toHaveCount(0);
  expect(await appointmentRecord("reschedule-source")).toEqual(original);
  await page.locator("#reschedule-date").fill("2026-11-03");
  await page.locator("#reschedule-time").fill("10:00");
  await submitAndSettle(page, ".appointment-reschedule-form");
  const conflictLink = page.locator(".appointment-conflict-list a[href='/appointments/reschedule-conflict']");
  await expect(conflictLink).toContainText("Already booked tattoo client");
  await expect(conflictLink).toHaveAttribute("target", "_blank");
  expect(await appointmentRecord("reschedule-source")).toEqual(original);
  const acknowledge = page.locator(".appointment-reschedule-form input[type='checkbox']");
  await acknowledge.check();
  await expect(page.locator(".appointment-reschedule-form input[name='allowOverlap']")).toHaveValue("true");
  await page.locator("#reschedule-time").fill("10:15");
  await expect(page.locator(".appointment-reschedule-form input[name='allowOverlap']")).toHaveValue("false");
  await submitAndSettle(page, ".appointment-reschedule-form");
  await expect(acknowledge).not.toBeChecked();
  await expect(conflictLink).toBeVisible();
  await acknowledge.check();
  await page.locator(".appointment-reschedule-form button[type='submit']").click();
  await expect(page.locator(".appointment-record-meta > time")).toHaveAttribute("datetime", "2026-11-03T09:15:00.000Z");
  await expect(page.locator(".appointment-reschedule-form")).toHaveCount(0);
  const moved = await appointmentRecord("reschedule-source");
  expect(moved).toEqual({ ...original, startsAt: "2026-11-03T09:15" });

  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  for (const date of ["2027-03-28", "2026-10-25"]) {
    await page.locator("#reschedule-date").fill(date);
    await page.locator("#reschedule-time").fill("02:30");
    await submitAndSettle(page, ".appointment-reschedule-form");
    await assertAssociatedError(page, "#reschedule-date");
    await assertAssociatedError(page, "#reschedule-time");
    await expect(page.locator("#reschedule-date")).toBeFocused();
    expect(await appointmentRecord("reschedule-source")).toEqual(moved);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator(".appointment-page")).not.toContainText(/\b(?:duraci[oó]n|duration)\b/i);
  const screenshot = testInfo.outputPath("mobile-appointment-reschedule.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("mobile-appointment-reschedule", { path: screenshot, contentType: "image/png" });
});

test("cancellation confirms intent, respects a completed record from a stale view and preserves tattoo history", async ({ page }) => {
  await signUp(page);
  await seedAppointment("cancellation-source", "Cancellation workflow client", "2026-11-10T09:00:00.000Z");
  await seedAppointment("cancellation-no-show", "No-show workflow client", "2026-11-11T09:00:00.000Z", "NO_SHOW");
  await withTestDatabase(pool => pool.query('UPDATE "Appointment" SET "agreedPrice"=25,"depositRequired"=25 WHERE id=$1', ["cancellation-no-show"]));
  const original = await appointmentRecord("cancellation-source");
  await page.goto("/appointments/cancellation-source");
  page.once("dialog", async dialog => { expect(dialog.message()).toMatch(/cancel/i); await dialog.dismiss(); });
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  expect(await appointmentRecord("cancellation-source")).toEqual(original);

  // Another view completes the appointment while this rendered cancel button is stale.
  await withTestDatabase(pool => pool.query('UPDATE "Appointment" SET status=\'COMPLETED\' WHERE id=$1', ["cancellation-source"]));
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(page.locator(".appointment-detail-header [data-status='COMPLETED']")).toBeVisible();
  expect(await appointmentRecord("cancellation-source")).toEqual({ ...original, status: "COMPLETED" });
  await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reschedule", exact: true })).toHaveCount(0);

  await page.goto("/appointments/cancellation-source/edit");
  await page.locator("#appointment-status").selectOption("PLANNED");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/appointments/cancellation-source");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(page.locator(".appointment-detail-header [data-status='CANCELLED']")).toBeVisible();
  expect(await appointmentRecord("cancellation-source")).toEqual({ ...original, status: "CANCELLED" });
  await expect(page.locator(".payment-history-list li")).toHaveCount(1);
  const historicalBalance = page.locator(".money-summary-grid > div").filter({ has: page.locator("dt", { hasText: "Difference from agreed price" }) });
  await expect(historicalBalance.locator("dd")).toHaveText("€300.00");
  await expect(page.locator(".appointment-deposit-summary")).not.toContainText("Deposit remaining");
  await page.goto("/calendar?view=day&anchor=2026-11-10");
  await expect(page.locator("a[href='/appointments/cancellation-source']")).toHaveCount(0);
  await page.goto("/appointments/cancellation-no-show");
  await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reschedule", exact: true })).toHaveCount(0);
  await expect(page.locator("a[href='/appointments/cancellation-no-show/edit']")).toBeVisible();
  await expect(historicalBalance.locator("dd")).toHaveText("-€25.00");
  await expect(page.locator(".appointment-deposit-summary")).not.toContainText("Deposit remaining");
});
