import { type Page, type TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "./fixtures";
import { fillAppointmentStart } from "./appointment-helpers";

const monday = { id: "visibility-monday", name: "Monday tattoo client", date: "2026-10-05", time: "10:00", instant: "2026-10-05T08:00:00.000Z", status: "CONFIRMED" };
const friday = { id: "visibility-friday", name: "Friday tattoo client", date: "2026-10-09", time: "15:00", instant: "2026-10-09T13:00:00.000Z", status: "PLANNED" };
const followingWeek = { id: "visibility-following-week", name: "Following week client", date: "2026-10-12", time: "10:00", instant: "2026-10-12T08:00:00.000Z", status: "PLANNED" };
const cancelled = { id: "visibility-cancelled", name: "Cancelled tattoo client", date: "2026-10-06", time: "10:00", instant: "2026-10-06T08:00:00.000Z", status: "CANCELLED" };
const previousMonth = { id: "visibility-previous-month", name: "September boundary client", date: "2026-09-30", time: "10:00", instant: "2026-09-30T08:00:00.000Z", status: "PLANNED" };
const nextMonth = { id: "visibility-next-month", name: "November boundary client", date: "2026-11-02", time: "10:00", instant: "2026-11-02T09:00:00.000Z", status: "PLANNED" };

async function prepareCalendar(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-up");
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  }
  await page.locator("#name").fill("Calendar visibility artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Calendar-Visibility-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");

  // Follow the artist's real client → booking → save → calendar flow before
  // adding synthetic records for cancellation and period-boundary checks.
  await page.goto("/clients/new");
  await page.locator("#client-name").fill(monday.name);
  await page.locator("#client-phone").fill("+34611007001");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.goto(`/new-appointment?date=${monday.date}`);
  await expect(page.locator("#appointment-date")).toHaveValue(monday.date);
  await page.locator("#appointment-client").selectOption(clientId);
  await fillAppointmentStart(page, `${monday.date}T${monday.time}`);
  await page.locator("#appointment-status").selectOption(monday.status);
  await page.locator("#appointment-notes").fill("Monday booking created through the artist's normal form");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const bookedMonday = { ...monday, id: new URL(page.url()).pathname.split("/").at(-1)! };
  await expect(page.locator(".appointment-detail-header h1")).toHaveText(monday.name);
  await expect(page.locator(".appointment-notes")).toHaveText("Monday booking created through the artist's normal form");
  const exportResponse = await page.request.get("/api/account/export");
  expect(exportResponse.status()).toBe(200);
  expect((await exportResponse.json()).appointments).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: bookedMonday.id, clientId, startsAt: monday.instant, status: monday.status }),
  ]));
  await page.goto(`/calendar?view=day&anchor=${monday.date}`);
  await expect(page.locator(`.calendar-page a[href='/appointments/${bookedMonday.id}']`)).toBeVisible();
  await expect(page.locator(".calendar-agenda h3")).toHaveText(monday.name);
  await expect(page.locator(".calendar-session-count strong")).toHaveText("01");

  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Calendar visibility fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try {
    const artist = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    expect(artist.rows).toHaveLength(1);
    // Insert out of order so rendering must order by Madrid date and time.
    for (const row of [friday, nextMonth, cancelled, previousMonth, followingWeek]) {
      const clientId = `${row.id}-client`;
      await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())',
        [clientId, artist.rows[0].id, row.name, "+34611007000"]);
      await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") VALUES ($1,$2,$3,$4,120,$5::"AppointmentStatus",now())',
        [row.id, artist.rows[0].id, clientId, row.instant, row.status]);
    }
  } finally { await pool.end(); }
  return bookedMonday;
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function expectAppointmentGroup(page: Page, appointment: typeof monday) {
  const href = `/appointments/${appointment.id}`;
  await expect(page.locator(`.calendar-page a[href='${href}']:visible`)).toHaveCount(1);
  const group = page.locator(".calendar-agenda:visible").filter({ has: page.locator(`a[href='${href}']`) });
  await expect(group).toHaveCount(1);
  await expect(group.locator("h2")).toBeVisible();
  await expect(group.locator("h3")).toHaveText(appointment.name);
  await expect(group.locator(".calendar-session-time strong")).toHaveText(appointment.time);
}

test("mobile and tablet Week show every booked day immediately without selecting its date", async ({ page }, testInfo) => {
  const bookedMonday = await prepareCalendar(page);
  const url = "/calendar?view=week&anchor=2026-10-07";
  await page.goto(url);
  // Capture the original selected-Wednesday bug before asserting that Monday
  // and Friday are available without tapping either date.
  await capture(page, testInfo, "mobile-week-visible-bookings");
  await expectAppointmentGroup(page, bookedMonday);
  await expectAppointmentGroup(page, friday);
  await expect(page.locator(".calendar-mobile-week .calendar-agenda:visible h2")).toHaveText([
    "Monday, 5 October 2026", "Friday, 9 October 2026",
  ]);
  await expect(page.locator(`.calendar-page a[href='/appointments/${cancelled.id}']`)).toHaveCount(0);
  await expect(page.locator(`.calendar-page a[href='/appointments/${followingWeek.id}']`)).toHaveCount(0);
  await expect(page.locator(".calendar-session-count strong")).toHaveText("02");
  await expect(page).toHaveURL(url);
  await expect(page.locator(".calendar-new-button")).toHaveAttribute("href", "/new-appointment?date=2026-10-07");

  await page.setViewportSize({ width: 820, height: 1180 });
  await expectAppointmentGroup(page, bookedMonday);
  await expectAppointmentGroup(page, friday);
  await capture(page, testInfo, "tablet-week-visible-bookings");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#calendar-tab-2026-10-09").click();
  await expect(page).toHaveURL(url => url.searchParams.get("view") === "week" && url.searchParams.get("anchor") === "2026-10-09");
  await expect(page.locator("#calendar-tab-2026-10-09")).toHaveAttribute("aria-pressed", "true");
  await expectAppointmentGroup(page, bookedMonday);
  await expectAppointmentGroup(page, friday);
  await expect(page.locator(".calendar-new-button")).toHaveAttribute("href", "/new-appointment?date=2026-10-09");
  await page.locator(".calendar-view-switch").getByRole("button", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("view") === "day" && url.searchParams.get("anchor") === "2026-10-09");
  await expect(page.locator(`.calendar-page a[href='/appointments/${friday.id}']`)).toBeVisible();
  await expect(page.locator(`.calendar-page a[href='/appointments/${bookedMonday.id}']`)).toHaveCount(0);
});

test("mobile Month names all appointments immediately while keeping cancelled and adjacent-month bookings out of its agenda", async ({ page }, testInfo) => {
  const bookedMonday = await prepareCalendar(page);
  const url = "/calendar?view=month&anchor=2026-10-07";
  await page.goto(url);
  // The old month view shows counts while hiding every client/details link.
  await capture(page, testInfo, "mobile-month-visible-bookings");
  for (const appointment of [bookedMonday, friday, followingWeek]) await expectAppointmentGroup(page, appointment);
  await expect(page.locator(".calendar-agenda:visible h2")).toHaveText([
    "Monday, 5 October 2026", "Friday, 9 October 2026", "Monday, 12 October 2026",
  ]);
  for (const appointment of [cancelled, previousMonth, nextMonth]) {
    await expect(page.locator(`.calendar-agenda a[href='/appointments/${appointment.id}']`)).toHaveCount(0);
    await expect(page.locator(`.calendar-page a[href='/appointments/${appointment.id}']:visible`)).toHaveCount(0);
  }
  await expect(page.locator(".calendar-session-count strong")).toHaveText("03");
  await expect(page).toHaveURL(url);
  await expect(page.locator(".calendar-new-button")).toHaveAttribute("href", "/new-appointment?date=2026-10-07");
  await page.locator(`.calendar-page a[href='/appointments/${friday.id}']:visible`).click();
  await expect(page).toHaveURL(`/appointments/${friday.id}`);
  await expect(page.locator(".appointment-detail-header h1")).toHaveText(friday.name);

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(url);
  for (const appointment of [bookedMonday, friday, followingWeek]) {
    await expect(page.locator(`.calendar-month-grid a[href='/appointments/${appointment.id}']`)).toBeVisible();
  }
  await expect(page.locator(`.calendar-page a[href='/appointments/${cancelled.id}']`)).toHaveCount(0);
  await capture(page, testInfo, "tablet-month-visible-bookings");
});
