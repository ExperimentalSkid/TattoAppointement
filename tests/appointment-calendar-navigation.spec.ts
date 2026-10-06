import { expect, test } from "./fixtures";
import { fillAppointmentStart } from "./appointment-helpers";

// The artist's device timezone must not change the booking's calendar date.
test.use({ timezoneId: "America/New_York" });

test("saved future appointments open their Madrid week directly in both languages, while cancelled records do not offer that action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime("2026-10-03T12:00:00.000Z");
  await page.goto("/sign-up");
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  }
  await page.locator("#name").fill("Calendar return artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Calendar-Return-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Future midnight tattoo client");
  await page.locator("#client-phone").fill("+34611007002");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientId = new URL(page.url()).pathname.split("/").at(-1)!;

  // 00:30 on Madrid's Monday is 23:30 UTC on Sunday. A UTC date slice would
  // incorrectly open the preceding week, recreating the hidden-booking gap.
  await page.goto("/new-appointment?date=2026-11-02");
  await page.locator("#appointment-client").selectOption(clientId);
  await fillAppointmentStart(page, "2026-11-02T00:30");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const appointmentPath = new URL(page.url()).pathname;
  await expect(page.locator(".appointment-record-meta > time")).toHaveAttribute("datetime", "2026-11-01T23:30:00.000Z");

  // Returning through the generic navigation still shows today's week. The
  // contextual action must open the saved booking's week without a date tap.
  await page.locator(".mobile-nav a[href='/calendar']").click();
  await expect(page.locator(".calendar-range-label")).toHaveText("28 Sept – 4 Oct, 2026");
  await expect(page.locator(`.calendar-page a[href='${appointmentPath}']`)).toHaveCount(0);

  for (const [locale, label] of [["en", "View in calendar"], ["es", "Ver en el calendario"]] as const) {
    await page.goto(appointmentPath);
    if (locale === "es") {
      await page.locator(".app-topbar .language-select").selectOption(locale);
    }
    const calendarLink = page.locator(".appointment-record-actions").getByRole("link", { name: label, exact: true });
    await expect(calendarLink).toHaveAttribute("href", "/calendar?view=week&anchor=2026-11-02");
    await calendarLink.click();
    await expect(page).toHaveURL("/calendar?view=week&anchor=2026-11-02");
    const booking = page.locator(".calendar-mobile-week .calendar-agenda").filter({ has: page.locator(`a[href='${appointmentPath}']`) });
    await expect(booking.locator("h3")).toHaveText("Future midnight tattoo client");
    await expect(booking.locator(".calendar-session-time strong")).toHaveText("00:30");
  }

  await page.goto(`${appointmentPath}/edit`);
  await page.locator("#appointment-status").selectOption("CANCELLED");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === appointmentPath);
  await expect(page.locator(".appointment-detail-header [data-status='CANCELLED']")).toBeVisible();
  await expect(page.locator(".appointment-record-actions a[href^='/calendar']")).toHaveCount(0);
});
