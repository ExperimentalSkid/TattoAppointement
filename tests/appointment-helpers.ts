import type { Page } from "@playwright/test";

export async function fillAppointmentStart(page: Page, startsAtLocal: string) {
  const [date, time] = startsAtLocal.split("T");
  await page.locator("#appointment-date").fill(date);
  await page.locator("#appointment-time").fill(time);
}

export async function revealAppointmentMoney(page: Page) {
  const disclosure = page.locator(".appointment-money-disclosure");
  if (!(await disclosure.evaluate(element => (element as HTMLDetailsElement).open))) {
    await disclosure.locator("summary").click();
  }
}
