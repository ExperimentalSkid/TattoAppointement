import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fillAppointmentStart } from "./appointment-helpers";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const actionError = "The action could not be completed. Check the record before trying again.";
const spanishActionError = "No se pudo completar la acción. Comprueba el registro antes de intentarlo de nuevo.";

async function artist(page: Page) {
  await page.goto("/sign-up");
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  await page.locator("#name").fill("Action recovery artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Action-Recovery-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function records(page: Page) {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  const data = await response.json() as {
    appointments: Record<string, unknown>[];
    payments: Record<string, unknown>[];
    designs: Record<string, unknown>[];
  };
  return { appointments: data.appointments, payments: data.payments, designs: data.designs };
}

async function booking(page: Page) {
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Recovery tattoo client");
  await page.locator("#client-phone").fill("+34611009808");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  await page.goto("/new-appointment?date=2027-11-05");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await fillAppointmentStart(page, "2027-11-05T10:00");
  await page.locator("#appointment-notes").fill("Saved tattoo booking");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

// Drop the actual browser transport before it reaches the app. All fixture data
// is created through the UI in the existing guarded disposable _e2e database.
async function interrupt(page: Page, info: TestInfo, path: string, button: Locator, container: Locator,
  drafts: Record<string, string>, message: string, confirmation = true) {
  const before = await records(page);
  let requests = 0;
  let aborted = false;
  let confirmations = 0;
  if (confirmation) page.on("dialog", async dialog => {
    expect(dialog.type()).toBe("confirm");
    confirmations += 1;
    await dialog.accept();
  });
  await page.route(url => url.pathname === path, async route => {
    const request = route.request();
    if (request.method() === "POST" && (!confirmation || request.headers()["next-action"])) {
      requests += 1;
      if (requests === 1) { aborted = true; await route.abort("failed"); return; }
    }
    await route.continue();
  });
  await button.click();
  await expect.poll(async () => await container.locator("[role='alert']").count() > 0 || await page.locator(".route-message").isVisible(), { timeout: 4_000 }).toBe(true).catch(() => {});
  const entered: Record<string, string | null> = {};
  for (const field of Object.keys(drafts)) entered[field] = await page.locator(field).count() ? await page.locator(field).inputValue() : null;
  const after = await records(page);
  const screenshot = info.outputPath("interrupted-action.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("interrupted-action", { path: screenshot, contentType: "image/png" });
  await info.attach("interrupted-action-diagnostic", { body: JSON.stringify({ actualPostAborted: aborted, requests, confirmations,
    actionStillMounted: await container.count() > 0, enteredValues: entered, recordsUnchanged: JSON.stringify(before) === JSON.stringify(after),
    inlineError: await container.locator("[role='alert']").allTextContents(), errorBoundaryText: await page.locator(".route-message").allTextContents(),
    retry: await button.count() ? "Manual retry remains available below." : "Impossible: action and nearby draft were replaced." }, null, 2), contentType: "application/json" });
  expect(aborted).toBe(true);
  expect(requests).toBe(1);
  expect(confirmations).toBe(confirmation ? 1 : 0);
  expect(after).toEqual(before);
  expect(entered).toEqual(drafts);
  await expect(container).toBeVisible({ timeout: 3_000 });
  await expect(container.locator("[role='alert']")).toHaveText(message, { timeout: 3_000 });
  await expect(button).toBeEnabled({ timeout: 3_000 });
  return { before, requests: () => requests, confirmations: () => confirmations };
}

for (const operation of ["Remove payment", "Cancel appointment", "Delete appointment"] as const) {
  test(`interrupted ${operation.toLowerCase()} preserves the record and nearby draft until a confirmed manual retry`, async ({ page }, info) => {
    await artist(page);
    const path = await booking(page);
    if (operation === "Remove payment") {
      await page.locator("#payment-amount").fill("25.00");
      await page.locator(".payment-entry-form button[type='submit']").click();
      await expect(page.locator(".payment-history-list li")).toHaveCount(1);
    }
    const draft = { "#payment-amount": "88.75" };
    await page.locator("#payment-amount").fill(draft["#payment-amount"]);
    const button = page.getByRole("button", { name: operation, exact: true });
    const result = await interrupt(page, info, path, button, button.locator(".."), draft, actionError);
    await button.click();
    if (operation === "Remove payment") {
      await expect(page.locator(".payment-history-list li")).toHaveCount(0);
      await expect(page.locator("#payment-amount")).toHaveValue(draft["#payment-amount"]);
      expect((await records(page)).payments).toEqual([]);
      expect((await records(page)).appointments).toEqual(result.before.appointments);
    } else if (operation === "Cancel appointment") {
      await expect(page.locator(".appointment-detail-header [data-status='CANCELLED']")).toBeVisible();
      expect((await records(page)).appointments).toEqual([expect.objectContaining({ id: path.split("/").at(-1), status: "CANCELLED" })]);
    } else {
      await page.waitForURL(/\/clients\/[A-Za-z0-9_-]+$/);
      expect((await records(page)).appointments).toEqual([]);
    }
    expect(result.requests()).toBe(2);
    expect(result.confirmations()).toBe(2);
  });
}

test("interrupted artwork deletion keeps unsaved metadata, reports in Spanish and retries only after confirmation", async ({ page }, info) => {
  await artist(page);
  await page.goto("/designs/new");
  await page.locator("#design-image").setInputFiles({ name: "action-recovery.png", mimeType: "image/png", buffer: png });
  await page.locator("#design-title").fill("Saved tattoo artwork");
  await page.locator(".design-form button[type='submit']").click();
  await page.waitForURL(/\/designs\/(?!new$)[A-Za-z0-9_-]+$/);
  const path = new URL(page.url()).pathname;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${path}/edit`);
  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const draft = { "#design-title": "Título sin guardar", "#design-notes": "Conservar las notas de este tatuaje." };
  for (const [field, value] of Object.entries(draft)) await page.locator(field).fill(value);
  const button = page.getByRole("button", { name: "Eliminar diseño", exact: true });
  const result = await interrupt(page, info, `${path}/edit`, button, button.locator(".."), draft, spanishActionError);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await button.click();
  await page.waitForURL(url => url.pathname === "/designs");
  expect((await records(page)).designs).toEqual([]);
  expect((await page.request.get(`/api${path}/image?variant=original`)).status()).toBe(404);
  expect(result.requests()).toBe(2);
  expect(result.confirmations()).toBe(2);
});

test("interrupted sign-out keeps the session and studio draft, shows feedback and permits manual retry", async ({ page }, info) => {
  await artist(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const draft = { "#studio-name": "Unsaved tattoo studio" };
  await page.locator("#studio-name").fill(draft["#studio-name"]);
  const button = page.locator(".mobile-signout .signout-button");
  const baseline = new Map<number, { identityWidth: number; buttonWidth: number; languageWidth: number }>();
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    baseline.set(width, await page.locator(".app-topbar").evaluate(header => ({
      identityWidth: header.querySelector(".topbar-app-name")!.getBoundingClientRect().width,
      buttonWidth: header.querySelector(".signout-button")!.getBoundingClientRect().width,
      languageWidth: header.querySelector(".language-select")!.getBoundingClientRect().width,
    })));
  }
  const result = await interrupt(page, info, "/api/auth/sign-out", button, page.locator(".mobile-signout"), draft, "Sign-out failed. Please try again.", false);
  await expect(page.locator(".studio-settings-form")).toBeVisible();
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.locator(".app-topbar").evaluate(header => {
      const box = (selector: string) => {
        const element = selector === ":scope" ? header as HTMLElement : header.querySelector<HTMLElement>(selector)!;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
          height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      };
      const alert = header.querySelector(".signout-error")!;
      const range = document.createRange();
      range.selectNodeContents(alert);
      const styles = getComputedStyle(header);
      return { header: box(":scope"), identity: box(".topbar-app-name"), button: box(".signout-button"), language: box(".language-select"),
        alert: box(".signout-error"), text: Array.from(range.getClientRects()).map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
        paddingLeft: parseFloat(styles.paddingLeft), paddingRight: parseFloat(styles.paddingRight), paddingBottom: parseFloat(styles.paddingBottom),
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    const screenshot = info.outputPath(`signout-recovery-${width}.png`);
    await page.screenshot({ path: screenshot });
    await info.attach(`signout-recovery-${width}`, { path: screenshot, contentType: "image/png" });
    await info.attach(`signout-layout-${width}`, { body: JSON.stringify(layout, null, 2), contentType: "application/json" });
    const before = baseline.get(width)!;
    expect(layout.identity.width).toBeGreaterThanOrEqual(before.identityWidth - 1);
    expect(layout.identity.scrollWidth).toBeLessThanOrEqual(layout.identity.clientWidth + 1);
    expect(layout.button.width).toBeCloseTo(before.buttonWidth, 0);
    expect(layout.language.width).toBeCloseTo(before.languageWidth, 0);
    expect(Math.min(layout.button.height, layout.language.height)).toBeGreaterThanOrEqual(44);
    expect(layout.alert.top).toBeGreaterThanOrEqual(Math.max(layout.button.bottom, layout.language.bottom, layout.identity.bottom) + 8);
    expect(layout.alert.width).toBeGreaterThanOrEqual(layout.header.width - layout.paddingLeft - layout.paddingRight - 1);
    expect(layout.alert.scrollWidth).toBeLessThanOrEqual(layout.alert.clientWidth + 1);
    expect(layout.header.bottom).toBeGreaterThanOrEqual(layout.alert.bottom + layout.paddingBottom - 1);
    expect(layout.text.length).toBeGreaterThan(0);
    for (const line of layout.text) {
      expect(line.left).toBeGreaterThanOrEqual(layout.alert.left);
      expect(line.right).toBeLessThanOrEqual(layout.alert.right + 1);
      expect(line.top).toBeGreaterThanOrEqual(layout.alert.top);
      expect(line.bottom).toBeLessThanOrEqual(layout.alert.bottom + 1);
    }
    expect(layout.documentOverflow).toBeLessThanOrEqual(1);
    await expect(page.locator("#studio-name")).toHaveValue(draft["#studio-name"]);
  }
  await button.click();
  await page.waitForURL(url => url.pathname === "/sign-in");
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.locator(".auth-form")).toBeVisible();
  expect((await page.request.get("/api/account/export")).status()).toBe(401);
  expect(result.requests()).toBe(2);
});
