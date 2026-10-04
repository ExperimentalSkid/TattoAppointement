import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fillAppointmentStart } from "./appointment-helpers";

const origin = "http://127.0.0.1:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function artist(page: Page) {
  await page.goto("/sign-up");
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  await page.locator("#name").fill("Save recovery artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Save-Recovery-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function exported(page: Page) {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  return response.json();
}

// A real browser POST is dropped before reaching the app. Existing guarded
// fixtures reset only the explicitly disposable _e2e database, never previews.
async function interrupt(page: Page, info: TestInfo, path: string, selector: string, values: Record<string, string>, message: string, serverAction = true) {
  let requests = 0;
  let aborted = false;
  await page.route(url => url.origin === origin && url.pathname === path, async route => {
    if (route.request().method() === "POST" && (!serverAction || route.request().headers()["next-action"])) {
      requests += 1;
      if (requests === 1) { aborted = true; await route.abort("failed"); return; }
    }
    await route.continue();
  });
  const form = page.locator(selector);
  await form.locator("button[type='submit']").click();
  // Capture either useful inline feedback or the actual route error boundary.
  await expect.poll(async () => (await form.locator(".form-error, [role='alert']").count()) > 0 || await page.locator(".route-message").isVisible(), { timeout: 4_000 }).toBe(true).catch(() => {});
  const mounted = await form.count() > 0;
  const captured: Record<string, string | null> = {};
  for (const field of Object.keys(values)) {
    captured[field] = await page.locator(field).count() ? await page.locator(field).evaluate(element => {
      const input = element as HTMLInputElement;
      return input.type === "file" ? Array.from(input.files ?? []).map(file => file.name).join(",") : input.value;
    }) : null;
  }
  const screenshot = info.outputPath("interrupted-save.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("interrupted-save", { path: screenshot, contentType: "image/png" });
  await info.attach("interrupted-save-diagnostic", { body: JSON.stringify({ actualPostAborted: aborted, requests, formMounted: mounted, enteredValues: captured,
    inlineError: mounted ? await form.locator(".form-error, [role='alert']").allTextContents() : [],
    errorBoundaryText: await page.locator(".route-message").allTextContents(),
    retry: mounted ? "Form remains available for retry below." : "Impossible: route error boundary replaced the entered form." }, null, 2), contentType: "application/json" });
  expect(aborted).toBe(true);
  expect(requests).toBe(1);
  await expect(form).toBeVisible({ timeout: 3_000 });
  await expect(form.locator(".form-error, [role='alert']").filter({ hasText: message }).first()).toBeVisible({ timeout: 3_000 });
  expect(captured).toEqual(values);
  await expect(form.locator("button[type='submit']")).toBeEnabled({ timeout: 3_000 });
  return { form, requests: () => requests };
}

test("interrupted studio identity save retains its draft and retries without losing the workspace", async ({ page }, info) => {
  await artist(page);
  await page.goto("/settings");
  const before = (await exported(page)).profile;
  const draft = { "#artist-name": "Recovered artist", "#studio-name": "Recovered atelier" };
  for (const [field, value] of Object.entries(draft)) await page.locator(field).fill(value);
  const result = await interrupt(page, info, "/settings", ".studio-settings-form", draft, "Changes could not be saved. Please try again.");
  expect((await exported(page)).profile).toEqual(before);
  await result.form.locator("button[type='submit']").click();
  await expect(result.form.locator(".settings-success")).toBeVisible();
  expect((await exported(page)).profile).toMatchObject({ name: draft["#artist-name"], studioName: draft["#studio-name"] });
  expect(result.requests()).toBe(2);
});

test("interrupted reminder save retains the exact message and retries successfully", async ({ page }, info) => {
  await artist(page);
  await page.goto("/settings");
  const before = (await exported(page)).profile.whatsappReminderTemplate;
  const draft = { "#whatsapp-reminder-template": "Hola {client},\nYour tattoo: {date} at {time}.\nFrom {studio}." };
  await page.locator("#whatsapp-reminder-template").fill(draft["#whatsapp-reminder-template"]);
  const result = await interrupt(page, info, "/settings", ".reminder-settings-form", draft, "The template could not be saved. Please try again.");
  expect((await exported(page)).profile.whatsappReminderTemplate).toBe(before);
  await result.form.locator("button[type='submit']").click();
  await expect(result.form.locator(".settings-success")).toBeVisible();
  expect((await exported(page)).profile.whatsappReminderTemplate).toBe(draft["#whatsapp-reminder-template"]);
  expect(result.requests()).toBe(2);
});

test("interrupted payment save keeps the entered amount and records only the successful retry", async ({ page }, info) => {
  await artist(page);
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Payment recovery client");
  await page.locator("#client-phone").fill("+34611009801");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  await page.goto("/new-appointment?date=2027-11-05");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await fillAppointmentStart(page, "2027-11-05T10:00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const path = new URL(page.url()).pathname;
  const draft = { "#payment-amount": "25.50" };
  await page.locator("#payment-amount").fill(draft["#payment-amount"]);
  const result = await interrupt(page, info, path, ".payment-entry-form", draft, "Could not record the payment.");
  expect((await exported(page)).payments).toEqual([]);
  await result.form.locator("button[type='submit']").click();
  await expect(result.form.locator(".form-success")).toHaveText("Payment recorded.");
  await expect(page.locator("#payment-amount")).toHaveValue("");
  expect((await exported(page)).payments).toEqual([expect.objectContaining({ appointmentId: path.split("/").at(-1), amount: "25.5" })]);
  expect(result.requests()).toBe(2);
});

test("interrupted artwork import preserves the file and metadata for a successful retry", async ({ page }, info) => {
  await artist(page);
  await page.goto("/designs/new");
  await page.locator("#design-image").setInputFiles({ name: "recovery-artwork.png", mimeType: "image/png", buffer: png });
  const draft = { "#design-image": "recovery-artwork.png", "#design-title": "Recovered linework", "#design-notes": "Forearm reference.\nPreserve this artwork draft." };
  await page.locator("#design-title").fill(draft["#design-title"]);
  await page.locator("#design-notes").fill(draft["#design-notes"]);
  const result = await interrupt(page, info, "/api/designs", ".design-form", draft, "Could not import the design.", false);
  expect((await exported(page)).designs).toEqual([]);
  await result.form.locator("button[type='submit']").click();
  await page.waitForURL(/\/designs\/(?!new$)[A-Za-z0-9_-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const savedDesigns = (await exported(page)).designs as { notes: string | null }[];
  // Multipart form encoding uses CRLF; compare the entered lines consistently.
  expect(savedDesigns.map(design => ({ ...design, notes: design.notes?.replace(/\r\n/g, "\n") ?? null }))).toEqual([
    expect.objectContaining({ id, title: draft["#design-title"], notes: draft["#design-notes"], originalName: draft["#design-image"] }),
  ]);
  const image = await page.request.get(`/api/designs/${id}/image?variant=original`);
  expect(image.status()).toBe(200);
  expect(await image.body()).toEqual(png);
  expect(result.requests()).toBe(2);
});
