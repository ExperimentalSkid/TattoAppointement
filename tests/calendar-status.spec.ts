import { expect, test } from "./fixtures";
import { type Page } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function createAppointment(page: Page, start: string, status: "PLANNED" | "COMPLETED", notes: string, initialPayment = "0.00") {
  await page.goto("/new-appointment");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await page.locator("#appointment-start").fill(start);
  await page.locator("#appointment-status").selectOption(status);
  await page.locator("input[name='designIds']").first().check();
  await page.locator("#appointment-notes").fill(notes);
  await page.locator("#agreed-price").fill("250.00");
  await page.locator("#deposit-required").fill("50.00");
  await page.locator("#initial-payment").fill(initialPayment);
  await expect(page.locator("input[name='allowOverlap']")).toHaveValue("false");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

test("cancelled appointments leave all calendar views, retain history and free the slot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Calendar status artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Calendar-Status-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar/);

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Calendar status client");
  await page.locator("#client-phone").fill("+34 611 000 333");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientPath = new URL(page.url()).pathname;

  const upload = await page.request.post("/api/designs", {
    multipart: { title: "Calendar status artwork", image: { name: "calendar.png", mimeType: "image/png", buffer: png } },
  });
  expect(upload.status()).toBe(201);

  const completedPath = await createAppointment(page, "2026-10-06T10:00", "COMPLETED", "Completed calendar appointment");
  const cancelledPath = await createAppointment(page, "2026-10-05T10:00", "PLANNED", "Retain these cancelled appointment notes", "25.00");

  for (const view of ["day", "week", "month"]) {
    await page.goto(`/calendar?view=${view}&anchor=2026-10-05`);
    await expect(page.locator(`.calendar-page a[href='${cancelledPath}']`).first()).toBeVisible();
  }

  await page.goto(cancelledPath);
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(page.locator(".status-pill[data-status='CANCELLED']")).toHaveText("Cancelled");

  for (const view of ["day", "week", "month"]) {
    await page.goto(`/calendar?view=${view}&anchor=2026-10-05`);
    await expect(page.locator(`.calendar-page a[href='${cancelledPath}']`)).toHaveCount(0);
    await expect(page.locator(".calendar-session-count strong")).toHaveText(view === "day" ? "00" : "01");
    await expect(page.locator(".calendar-legend [data-status='CANCELLED']")).toHaveCount(0);
    if (view !== "day") {
      await expect(page.locator(`.calendar-page a[href='${completedPath}']`).first()).toBeVisible();
    } else {
      await expect(page.getByText("No appointments", { exact: true })).toBeVisible();
    }
  }

  await page.goto("/calendar?view=day&anchor=2026-10-06");
  await expect(page.locator(`.calendar-page a[href='${completedPath}']`)).toBeVisible();
  await expect(page.locator(".calendar-session-count strong")).toHaveText("01");

  await page.goto(clientPath);
  const cancelledHistory = page.locator(`.appointment-history a[href='${cancelledPath}']`);
  await expect(cancelledHistory).toBeVisible();
  await expect(cancelledHistory.locator("[data-status='CANCELLED']")).toHaveText("Cancelled");
  await expect(page.locator(`.appointment-history a[href='${completedPath}']`)).toBeVisible();
  await cancelledHistory.click();
  await expect(page.locator(".appointment-notes")).toHaveText("Retain these cancelled appointment notes");
  await expect(page.locator(".appointment-design-gallery")).toContainText("Calendar status artwork");
  await expect(page.locator(".payment-history-list li")).toHaveCount(1);
  await expect(page.locator(".payment-history-list li")).toContainText("25.00");

  // A regular save, without overlap acknowledgement, proves that cancellation freed the slot.
  const replacementPath = await createAppointment(page, "2026-10-05T10:00", "PLANNED", "Replacement in freed calendar slot");
  expect(replacementPath).not.toBe(cancelledPath);
  for (const view of ["day", "week", "month"]) {
    await page.goto(`/calendar?view=${view}&anchor=2026-10-05`);
    await expect(page.locator(`.calendar-page a[href='${cancelledPath}']`)).toHaveCount(0);
    await expect(page.locator(`.calendar-page a[href='${replacementPath}']`).first()).toBeVisible();
    await expect(page.locator(".calendar-session-count strong")).toHaveText(view === "day" ? "01" : "02");
  }
});
