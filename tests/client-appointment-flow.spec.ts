import { expect, test } from "@playwright/test";

test("client detail starts a new appointment with that client preselected", async ({ page }) => {
  const unique = Date.now().toString(36);

  await page.goto("/sign-up");
  await page.locator("#name").fill("Client Flow Artist");
  await page.locator("#email").fill(`client-flow-${unique}@example.com`);
  await page.locator("#password").fill("ClientFlow-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar$/);

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Preselected Client");
  await page.locator("#client-phone").fill("+34 600 123 456");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);

  const clientPath = new URL(page.url()).pathname;
  const clientId = clientPath.split("/").at(-1)!;
  const newAppointmentLink = page.locator(`a[href="/new-appointment?clientId=${clientId}"]`);

  await expect(newAppointmentLink).toBeVisible();
  await newAppointmentLink.click();
  await page.waitForURL(new RegExp(`/new-appointment\\?clientId=${clientId}$`));
  await expect(page.locator("#appointment-client")).toHaveValue(clientId);

  await page.goto("/new-appointment?clientId=not-owned-by-this-artist");
  await expect(page.locator("#appointment-client")).toHaveValue("");
});
