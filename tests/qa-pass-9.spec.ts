import { expect, test } from "./fixtures";
import { type Browser, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function createArtistContext(browser: Browser) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
    timezoneId: "Europe/Madrid",
  });
  const page = await context.newPage();
  const unique = Date.now().toString(36);

  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("QA Pass 9 Artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("QAPass9-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar/, { timeout: 15_000 });

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("QA Pass 9 Client");
  await page.locator("#client-phone").fill(`+34 620 ${unique.slice(-3)} 009`);
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/, { timeout: 15_000 });

  await page.goto("/designs/new");
  await page.locator("#design-image").setInputFiles({
    name: "qa-pass-9.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.locator("#design-title").fill("QA Pass 9 Design");
  await page.locator(".design-form button[type='submit']").click();
  await page.waitForURL(/\/designs\/(?!new$)[A-Za-z0-9_-]+$/, { timeout: 15_000 });

  return { context, page };
}

async function fillAppointmentBase(page: Page) {
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await page.locator("#appointment-duration").fill("120");
  await page.locator("input[name='designIds']").first().check();
  await page.locator("input[name='finalDesignId']").first().check();
  await page.locator("#agreed-price").fill("350.00");
  await page.locator("#deposit-required").fill("100.00");
  await page.locator("#initial-payment").fill("25.00");
}

async function moneyValue(page: Page, label: string) {
  const item = page.locator(".money-summary-grid > div").filter({
    has: page.locator("dt", { hasText: label }),
  });
  const formatted = (await item.locator("dd").innerText()).trim();
  expect(formatted).toContain("€");
  return formatted.replace("€", "").trim();
}

test("QA pass 9 edge cases stay guarded", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await createArtistContext(browser);

  await page.goto("/new-appointment");
  await expect(page.locator("input[name='timezoneName']")).toHaveValue("Europe/Madrid");
  await fillAppointmentBase(page);
  await page.locator("#appointment-start").fill("2026-03-29T02:30");
  await page.locator(".appointment-form button[type='submit']").click();
  await expect(page.locator(".form-error")).toContainText("valid appointment date and time");
  await expect(page).toHaveURL(/\/new-appointment$/);

  await page.locator("#appointment-start").fill("2026-10-25T02:30");
  await page.locator(".appointment-form button[type='submit']").click();
  await expect(page.locator(".form-error")).toContainText("valid appointment date and time");

  await page.locator("#appointment-start").fill("2026-10-05T10:00");
  await page.locator("#agreed-price").fill("100000000.00");
  await page.locator(".appointment-form button[type='submit']").click();
  await expect(page.locator(".form-error")).toContainText("valid non-negative money amounts");

  await page.locator("#agreed-price").fill("350.00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  const appointmentPath = new URL(page.url()).pathname;
  expect(await moneyValue(page, "Amount received")).toBe("25.00");

  await page.locator("#payment-amount").fill("25.00");
  await page.locator(".payment-entry-form button[type='submit']").click();
  await expect(page.locator(".form-success")).toHaveText("Payment recorded.");
  await expect(page.locator("#payment-amount")).toHaveValue("");
  expect(await moneyValue(page, "Amount received")).toBe("50.00");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Remove the recorded payment");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Remove payment" }).first().click();
  await expect.poll(() => moneyValue(page, "Amount received"), { timeout: 15_000 }).toBe("25.00");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Delete this appointment");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Delete appointment" }).click();
  await expect(page).toHaveURL(new RegExp(`${appointmentPath}$`));

  await page.goto("/calendar?view=day&anchor=2026-02-31");
  await page.waitForURL((url) => {
    const anchor = url.searchParams.get("anchor");
    return Boolean(anchor && anchor !== "2026-02-31" && /^\d{4}-\d{2}-\d{2}$/.test(anchor));
  }, { timeout: 15_000 });

  await context.close();
});
