import { expect, test } from "./fixtures";
import { access } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { fillAppointmentStart, revealAppointmentMoney } from "./appointment-helpers";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("design deletion confirms intent, removes private files and preserves appointment history", async ({ page }) => {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Design deletion artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Design-Deletion-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar/);

  const title = "Artwork to delete";
  const upload = await page.request.post("/api/designs", {
    multipart: { title, image: { name: "delete-design.png", mimeType: "image/png", buffer: png } },
  });
  expect(upload.status()).toBe(201);
  const { id: designId } = await upload.json();
  const designPath = `/designs/${designId}`;

  // Read only this uploaded QA design's paths; the fixture guard excludes real studio databases.
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !databaseUrl.pathname.endsWith("_e2e")) {
    throw new Error("Design deletion verification requires the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: databaseUrl.href });
  let keys: string[];
  try {
    const stored = await pool.query<{ storageKey: string; previewKey: string }>(
      'SELECT "storageKey", "previewKey" FROM "Design" WHERE id=$1', [designId],
    );
    expect(stored.rows).toHaveLength(1);
    keys = [stored.rows[0].storageKey, stored.rows[0].previewKey];
  } finally {
    await pool.end();
  }
  // playwright.config.ts gives the QA server this dedicated directory.
  const storageRoot = path.resolve(".tmp/e2e-designs");
  const files = keys.map(key => {
    expect(typeof key).toBe("string");
    const file = path.resolve(storageRoot, key);
    expect(file.startsWith(`${storageRoot}${path.sep}`)).toBe(true);
    return file;
  });
  for (const file of files) await access(file);

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Design deletion client");
  await page.locator("#client-phone").fill("+34 611 000 444");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientPath = new URL(page.url()).pathname;

  await page.goto("/new-appointment");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await fillAppointmentStart(page, "2026-10-05T10:00");
  await page.locator(`input[name='designIds'][value='${designId}']`).check();
  await page.locator(`input[name='finalDesignId'][value='${designId}']`).check();
  await page.locator("#appointment-notes").fill("Keep these appointment notes after artwork deletion");
  await revealAppointmentMoney(page);
  await page.locator("#agreed-price").fill("250.00");
  await page.locator("#deposit-required").fill("100.00");
  await page.locator("#initial-payment").fill("50.00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const appointmentPath = new URL(page.url()).pathname;
  await expect(page.locator(`.appointment-design-gallery a[href='${designPath}']`)).toBeVisible();
  const moneyBefore = await page.locator(".money-summary-grid").innerText();

  await page.goto(`${designPath}/edit`);
  page.once("dialog", async dialog => {
    expect(dialog.message()).toMatch(/permanent/i);
    expect(dialog.message()).toMatch(/appointment/i);
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Delete design", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${designPath}/edit$`));
  await expect(page.locator("#design-title")).toHaveValue(title);
  expect((await page.request.get(`/api/designs/${designId}/image?variant=original`)).status()).toBe(200);
  for (const file of files) await access(file);

  page.once("dialog", async dialog => { await dialog.accept(); });
  await page.getByRole("button", { name: "Delete design", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/designs");
  await expect(page.locator(".design-card").filter({ hasText: title })).toHaveCount(0);
  for (const route of [designPath, `${designPath}/edit`]) {
    expect((await page.goto(route))?.status()).toBe(404);
  }
  for (const variant of ["original", "preview"]) {
    expect((await page.request.get(`/api/designs/${designId}/image?variant=${variant}`)).status()).toBe(404);
  }
  for (const file of files) await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });

  await page.goto(appointmentPath);
  await expect(page.locator(".appointment-notes")).toHaveText("Keep these appointment notes after artwork deletion");
  await expect(page.locator(`.appointment-design-gallery a[href='${designPath}']`)).toHaveCount(0);
  await expect(page.locator(".money-summary-grid")).toHaveText(moneyBefore, { useInnerText: true });
  await expect(page.locator(".payment-history-list li")).toHaveCount(1);
  await expect(page.locator(".payment-history-list li")).toContainText("50.00");
  await page.goto(clientPath);
  await expect(page.locator(`.appointment-history a[href='${appointmentPath}']`)).toBeVisible();
  await page.goto("/calendar?view=day&anchor=2026-10-05");
  await expect(page.locator(`.calendar-page a[href='${appointmentPath}']`)).toBeVisible();
});
