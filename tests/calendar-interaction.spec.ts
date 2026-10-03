import { expect, test } from "./fixtures";
import { type Page, type TestInfo } from "@playwright/test";
import { Pool } from "pg";

// Studio dates and times must stay in Madrid even when the artist's device is elsewhere.
test.use({ timezoneId: "America/New_York" });

async function signUp(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Calendar interaction artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Calendar-Interaction-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar/);
}

async function expectCalendarUrl(page: Page, view: string, anchor: string) {
  await expect(page).toHaveURL(url => url.pathname === "/calendar" && url.searchParams.get("view") === view && url.searchParams.get("anchor") === anchor);
}

async function captureCalendar(page: Page, testInfo: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator(".calendar-page")).not.toContainText(/\b(?:duraci[oó]n|duration)\b/i);
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" });
}

async function seedAppointments(rows: { id: string; name: string; startsAtIso: string; status: string }[]) {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !databaseUrl.pathname.endsWith("_e2e")) {
    throw new Error("Calendar fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: databaseUrl.href });
  try {
    const owner = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    for (const row of rows) {
      const clientId = `${row.id}-client`;
      await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', [clientId, owner.rows[0].id, row.name, "+34611000555"]);
      // Prisma timestamps are UTC; ISO strings avoid Windows pg local-Date serialization.
      await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") VALUES ($1,$2,$3,$4,120,$5::"AppointmentStatus",now())', [row.id, owner.rows[0].id, clientId, row.startsAtIso, row.status]);
    }
  } finally {
    await pool.end();
  }
}

test("mobile selected days persist through reload, views and keyboard navigation; booking keeps the date", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 900 });
  await signUp(page);
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Date context client");
  await page.locator("#client-phone").fill("+34 611 000 556");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const upload = await page.request.post("/api/designs", { multipart: { title: "Date context artwork", image: { name: "context.png", mimeType: "image/png", buffer: png } } });
  expect(upload.status()).toBe(201);

  await page.goto("/calendar?view=week&anchor=2026-10-07");
  await page.locator("#calendar-tab-2026-10-09").click();
  await expectCalendarUrl(page, "week", "2026-10-09");
  await expect(page.locator(".calendar-mobile-days")).toHaveAttribute("role", "group");
  await expect(page.locator("#calendar-tab-2026-10-09")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("#calendar-tab-2026-10-09")).toHaveAttribute("aria-pressed", "true");
  for (const view of ["day", "month", "week"]) {
    await page.locator(".calendar-view-switch").getByRole("button", { name: new RegExp(`^${view}$`, "i") }).click();
    await expectCalendarUrl(page, view, "2026-10-09");
  }
  await page.locator("#calendar-tab-2026-10-09").focus();
  await page.keyboard.press("ArrowRight");
  await expectCalendarUrl(page, "week", "2026-10-10");
  await expect(page.locator("#calendar-tab-2026-10-10")).toBeFocused();
  await expect(page.locator("#calendar-tab-2026-10-10")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowLeft");
  await expectCalendarUrl(page, "week", "2026-10-09");
  await expect(page.locator("#calendar-tab-2026-10-09")).toBeFocused();
  await expect(page.locator(".calendar-new-button")).toHaveAttribute("href", "/new-appointment?date=2026-10-09");
  const emptyAction = page.locator(".calendar-mobile-week .calendar-empty-featured a");
  await expect(emptyAction).toHaveAttribute("href", "/new-appointment?date=2026-10-09");
  await captureCalendar(page, testInfo, "mobile-selected-friday");
  await emptyAction.click();
  await expect(page.locator("#appointment-date")).toHaveValue("2026-10-09");
  await expect(page.locator("#appointment-time")).toHaveValue("");
  await expect(page.locator("#appointment-time")).toHaveAttribute("required", "");
  await expect(page.locator("input[name='startsAtLocal']")).toHaveValue("");
  await expect(page.locator("#appointment-start")).toHaveCount(0);
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await page.locator("input[name='designIds']").first().check();
  await page.locator("#appointment-time").fill("14:15");
  await expect(page.locator("input[name='startsAtLocal']")).toHaveValue("2026-10-09T14:15");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const appointmentPath = new URL(page.url()).pathname;
  await page.goto(`${appointmentPath}/edit`);
  await expect(page.locator("#appointment-date")).toHaveValue("2026-10-09");
  await expect(page.locator("#appointment-time")).toHaveValue("14:15");
  await expect(page.locator("input[name='startsAtLocal']")).toHaveValue("2026-10-09T14:15");
  for (const query of ["date=2026-02-31", "date=2026-02-29", "date=2026-10-09&date=2026-10-10"]) {
    await page.goto(`/new-appointment?${query}`);
    await expect(page.locator("#appointment-date")).toHaveValue("");
    await expect(page.locator("#appointment-time")).toHaveValue("");
  }
  expect(errors).toEqual([]);
});

test("mobile month counts and empty cell areas open the correct day", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 900 });
  await signUp(page);
  await seedAppointments([{ id: "month-count-appointment", name: "Mobile month client", startsAtIso: "2026-10-09T08:00:00.000Z", status: "CONFIRMED" }]);
  await page.goto("/calendar?view=month&anchor=2026-10-01");
  const bookedCell = page.locator(".calendar-month-day").filter({ hasText: /1 sessions/ });
  const bookedDay = bookedCell.locator(".calendar-month-open-day");
  await expect(bookedDay).toHaveCount(1);
  const countBox = await bookedCell.locator(".calendar-month-count").boundingBox();
  const buttonBox = await bookedDay.boundingBox();
  expect(countBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  await bookedDay.click({ position: { x: countBox!.x - buttonBox!.x + countBox!.width / 2, y: countBox!.y - buttonBox!.y + countBox!.height / 2 } });
  await expectCalendarUrl(page, "day", "2026-10-09");
  await expect(page.locator(".calendar-agenda h3")).toHaveText("Mobile month client");
  await page.goto("/calendar?view=month&anchor=2026-10-01");
  const emptyDay = page.locator(".calendar-month-open-day").filter({ hasText: /^10$/ }).first();
  const box = await emptyDay.boundingBox();
  expect(box).not.toBeNull();
  await emptyDay.click({ position: { x: box!.width - 5, y: box!.height - 5 } });
  await expectCalendarUrl(page, "day", "2026-10-10");
  await expect(page.getByText("No appointments", { exact: true })).toBeVisible();
  await page.goto("/calendar?view=month&anchor=2026-10-01");
  await captureCalendar(page, testInfo, "mobile-month-cell-targets");
  expect(errors).toEqual([]);
});

test("crowded weeks expose full client names and actions, with Madrid current-time orientation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signUp(page);
  const denseRows = [
    { id: "dense-calendar-one", name: "María García Fernández del Valle — a tattoo client with a particularly long name", startsAtIso: "2026-10-07T08:00:00.000Z", status: "PLANNED" },
    { id: "dense-calendar-two", name: "Alejandro Rodríguez de la Cruz — another long client name for a crowded day", startsAtIso: "2026-10-07T08:15:00.000Z", status: "CONFIRMED" },
    { id: "dense-calendar-three", name: "Lucía Martinez — overlapping appointment with a readable full client name", startsAtIso: "2026-10-07T08:30:00.000Z", status: "PLANNED" },
  ];
  await seedAppointments([...denseRows, { id: "calendar-no-show", name: "No-show calendar client", startsAtIso: "2026-10-08T08:00:00.000Z", status: "NO_SHOW" }]);
  await page.clock.setFixedTime("2026-10-07T12:30:00.000Z");
  await page.goto("/calendar?view=week&anchor=2026-10-07");
  await expect(page.locator(".calendar-legend [data-status='NO_SHOW']")).toHaveText("No-show");
  await expect(page.locator(".calendar-legend [data-status='CANCELLED']")).toHaveCount(0);
  for (const row of denseRows) {
    await expect(page.locator(".calendar-week-dense-agenda h3").filter({ hasText: row.name })).toBeVisible();
    await expect(page.locator(`.calendar-week-dense-agenda a[href='/appointments/${row.id}']`)).toBeVisible();
    await expect(page.locator(`.calendar-week-dense-agenda a[href='/appointments/${row.id}?reschedule=1#appointment-reschedule-form']`)).toBeVisible();
  }
  const marker = page.locator(".calendar-now-marker");
  await expect(marker).toHaveCount(1);
  await expect(marker.locator("time")).toHaveText("14:30");
  await expect(marker.locator("time")).toHaveAttribute("datetime", "2026-10-07T12:30:00.000Z");
  const markerPosition = await marker.evaluate(element => parseFloat((element as HTMLElement).style.top));
  expect(markerPosition).toBeCloseTo(374, 1); // 14:30 relative to 09:00, at 68px per hour.
  const markerBox = await marker.boundingBox();
  const scrollerBox = await page.locator(".calendar-week-scroll").boundingBox();
  expect(markerBox!.y).toBeGreaterThanOrEqual(scrollerBox!.y);
  expect(markerBox!.y).toBeLessThan(scrollerBox!.y + scrollerBox!.height);
  await captureCalendar(page, testInfo, "desktop-crowded-week");

  const eventDetails = page.locator(".calendar-event-details[href='/appointments/dense-calendar-one']");
  await eventDetails.focus();
  await expect(eventDetails).toBeFocused();
  const focusStyle = await eventDetails.evaluate(element => {
    const style = getComputedStyle(element.closest(".calendar-time-event")!);
    return { outline: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
  });
  expect(focusStyle).toEqual({ outline: "solid", width: "2px", offset: "-2px" });
  await captureCalendar(page, testInfo, "desktop-keyboard-focus");

  await page.setViewportSize({ width: 390, height: 900 });
  for (const row of denseRows) {
    await expect(page.locator(".calendar-mobile-week h3").filter({ hasText: row.name })).toBeVisible();
    await expect(page.locator(`.calendar-mobile-week a[href='/appointments/${row.id}?reschedule=1#appointment-reschedule-form']`)).toBeVisible();
  }
  await captureCalendar(page, testInfo, "mobile-crowded-week");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime("2027-01-05T13:30:00.000Z");
  await page.goto("/calendar?view=week&anchor=2027-01-05");
  await expect(marker.locator("time")).toHaveText("14:30");
  await page.goto("/calendar?view=week&anchor=2027-01-12");
  await expect(marker).toHaveCount(0);
  expect(errors).toEqual([]);
});
