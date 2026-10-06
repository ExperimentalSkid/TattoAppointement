import { expect, test } from "./fixtures";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { Pool } from "pg";

type ClientDraft = { name: string; phone: string; email: string; notes: string };
type ClientField = keyof ClientDraft;

const fields: ClientField[] = ["name", "phone", "email", "notes"];
const messages = {
  name: "Enter a name with up to 120 characters.",
  phone: "Enter a phone number with up to 40 characters.",
  email: "Enter a valid email address with up to 254 characters.",
  notes: "Keep notes within 4,000 characters.",
  duplicate: "A client with this phone number already exists.",
};
const storedDraft: ClientDraft = {
  name: "Nora Vega", phone: "+34611000311", email: "nora@example.test",
  notes: "Left forearm placement.\nKeep the linework reference for the next tattoo.",
};

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Client-form fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function signUp(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Client form QA artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Client-Form-QA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function seedClient(id: string, draft = storedDraft) {
  await withTestDatabase(async pool => {
    const owner = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    expect(owner.rows).toHaveLength(1);
    await pool.query(
      'INSERT INTO "Client" (id,"artistId",name,phone,email,notes,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())',
      [id, owner.rows[0].id, draft.name, draft.phone, draft.email || null, draft.notes || null],
    );
  });
}

async function clientRecord(id: string) {
  return withTestDatabase(async pool => {
    const result = await pool.query('SELECT name,phone,email,notes FROM "Client" WHERE id=$1', [id]);
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  });
}

async function fillDraft(form: Locator, draft: ClientDraft) {
  for (const field of fields) await form.locator(`#client-${field}`).fill(draft[field]);
}

async function expectDraft(form: Locator, draft: ClientDraft) {
  for (const field of fields) await expect(form.locator(`#client-${field}`)).toHaveValue(draft[field]);
}

async function expectFieldErrors(form: Locator, errors: Partial<Record<ClientField, string>>) {
  const summary = form.locator(".appointment-error-summary[role='alert']");
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("Check the client details");
  for (const [name, message] of Object.entries(errors)) {
    const field = form.locator(`#client-${name}`);
    await expect(summary).toContainText(message);
    await summary.locator(`a[href='#client-${name}']`).click();
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(await field.evaluate(element => (element.getAttribute("aria-describedby") ?? "")
      .split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" "))).toContain(message);
    await expect(form.locator(`#client-${name}-error`)).toHaveText(message);
  }
}

async function expectErrorsCleared(form: Locator) {
  await expect(form.locator(".appointment-error-summary")).toHaveCount(0);
  for (const field of fields) {
    await expect(form.locator(`#client-${field}`)).not.toHaveAttribute("aria-invalid", "true");
    await expect(form.locator(`#client-${field}-error`)).toHaveCount(0);
  }
}

async function captureForm(page: Page, testInfo: TestInfo, prefix: string) {
  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#client-notes")).toBeVisible();
    await expect(page.locator(".client-form button[type='submit']")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator("main").focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = testInfo.outputPath(`${prefix}-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`${prefix}-${viewport.width}`, { path: screenshot, contentType: "image/png" });
  }
}

test("new clients retain every rejected value and the server enforces the same four field limits as the form", async ({ page }) => {
  await signUp(page);
  await seedClient("form-existing", { ...storedDraft, phone: "+34 (611) 000-311" });
  await page.goto("/clients/new");
  const form = page.locator(".client-form");
  const submit = form.getByRole("button", { name: "Save client", exact: true });
  for (const [field, length] of Object.entries({ name: 120, phone: 40, email: 254, notes: 4000 })) {
    await expect(form.locator(`#client-${field}`)).toHaveAttribute("maxlength", String(length));
  }

  const invalid = { name: "   ", phone: " ( ) - ", email: "not an email", notes: "  Keep this private note.\n€ and 🖋️.  " };
  await fillDraft(form, invalid);
  await submit.click();
  await expectFieldErrors(form, { name: messages.name, phone: messages.phone, email: messages.email });
  await expectDraft(form, invalid);

  const duplicate = { name: "  Álex Linework  ", phone: " +34 611.000.311 ", email: "alex@example.test", notes: "  Left shoulder.\nKeep the original composition.  " };
  await fillDraft(form, duplicate);
  await expectErrorsCleared(form);
  await submit.click();
  await expectFieldErrors(form, { phone: messages.duplicate });
  await expectDraft(form, duplicate);
  await form.locator("#client-notes").fill(`${duplicate.notes} A draft correction.`);
  await expectErrorsCleared(form);

  // Only this disposable browser loses its native caps, so this rejection reaches the real server.
  for (const field of fields) await form.locator(`#client-${field}`).evaluate(element => element.removeAttribute("maxlength"));
  const oversized = { name: "N".repeat(121), phone: "6".repeat(41), email: `${"a".repeat(243)}@example.com`, notes: `${"T".repeat(3999)}\nT` };
  await fillDraft(form, oversized);
  await submit.click();
  await expectFieldErrors(form, { name: messages.name, phone: messages.phone, email: messages.email, notes: messages.notes });
  await expectDraft(form, oversized);
  const rejected = await withTestDatabase(pool => pool.query('SELECT count(*)::integer AS count FROM "Client"'));
  expect(rejected.rows[0].count).toBe(1);

  // Textareas count LF as one character; multipart must not turn this exact boundary into 4,001.
  const exactLimits = { name: "N".repeat(120), phone: "6".repeat(40), email: `${"a".repeat(242)}@example.com`, notes: `${"T".repeat(3998)}\nT` };
  await fillDraft(form, exactLimits);
  await expectErrorsCleared(form);
  await submit.click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(await clientRecord(id)).toEqual(exactLimits);
  await page.goto(`/clients/${id}/edit`);
  await expectDraft(page.locator(".client-form"), exactLimits);
});

test("editing preserves rejected drafts, excludes the current phone from duplicates and saves optional values consistently", async ({ page }) => {
  await signUp(page);
  await seedClient("form-edit");
  await seedClient("form-other", { ...storedDraft, name: "Other client", phone: "+34611000312" });
  await page.goto("/clients/form-edit/edit");
  const form = page.locator(".client-form");
  const submit = form.getByRole("button", { name: "Save client", exact: true });
  const duplicate = { name: "  Renée Ink  ", phone: " +34 (611) 000-312 ", email: "renee@example.test", notes: "  A new note.\nKeep both lines and my spacing.  " };
  await fillDraft(form, duplicate);
  await submit.click();
  await expectFieldErrors(form, { phone: messages.duplicate });
  await expectDraft(form, duplicate);
  expect(await clientRecord("form-edit")).toEqual(storedDraft);

  const invalidEmail = { ...duplicate, phone: " +34 (611) 000-311 ", email: "renee@" };
  await fillDraft(form, invalidEmail);
  await expectErrorsCleared(form);
  await submit.click();
  await expectFieldErrors(form, { email: messages.email });
  await expectDraft(form, invalidEmail);
  expect(await clientRecord("form-edit")).toEqual(storedDraft);

  const corrected = { ...invalidEmail, email: duplicate.email };
  await fillDraft(form, corrected);
  await submit.click();
  await page.waitForURL(url => url.pathname === "/clients/form-edit");
  const normalized = { name: corrected.name.trim(), phone: storedDraft.phone, email: corrected.email.trim(), notes: corrected.notes.trim() };
  expect(await clientRecord("form-edit")).toEqual(normalized);
  await page.goto("/clients/form-edit/edit");
  await expectDraft(form, normalized);

  await form.locator("#client-email").fill("   ");
  await form.locator("#client-notes").fill("   ");
  await submit.click();
  await page.waitForURL(url => url.pathname === "/clients/form-edit");
  expect(await clientRecord("form-edit")).toEqual({ ...normalized, email: null, notes: null });
  await page.goto("/clients/form-edit/edit");
  await expect(form.locator("#client-email")).toHaveValue("");
  await expect(form.locator("#client-notes")).toHaveValue("");
  await form.locator("#client-name").fill("Unsaved edit cancelled");
  await form.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/clients/form-edit");
  await expect(page.locator(".page-heading")).toHaveText(normalized.name);
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Unsaved new client");
  await page.getByRole("link", { name: "← Back to clients", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/clients");
  await expect(page.locator(".client-list-item")).toHaveCount(2);
  await expect(page.locator("main")).not.toContainText("Unsaved new client");
});

test("saving locks the submitted draft, prevents repeated requests and supports retry after a connection failure", async ({ page }) => {
  await signUp(page);
  await seedClient("form-pending-existing");
  await page.goto("/clients/new");
  const form = page.locator(".client-form");
  const draft = { name: "  Held client  ", phone: " +34 611 000 313 ", email: "held@example.test", notes: "  Keep this complete draft while saving.  " };
  await fillDraft(form, draft);
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/clients/new", async route => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      requests += 1;
      if (requests === 1) {
        await gate;
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  try {
    // Both submissions occur in one browser task, before React can paint disabled controls.
    await form.evaluate(element => {
      const clientForm = element as HTMLFormElement;
      clientForm.requestSubmit();
      clientForm.requestSubmit();
    });
    const saving = form.getByRole("button", { name: "Saving…", exact: true });
    await expect(saving).toBeDisabled();
    await expect(form).toHaveAttribute("aria-busy", "true");
    for (const field of fields) await expect(form.locator(`#client-${field}`)).toBeDisabled();
    await expect(form.getByRole("button", { name: "Choose from phone contacts", exact: true })).toBeDisabled();
    await expectDraft(form, draft);
    const bounds = await saving.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await expect.poll(() => requests).toBe(1);
    release();
    const summary = form.locator(".appointment-error-summary[role='alert']");
    await expect(summary).toBeFocused();
    await expect(summary).toContainText("Could not save the client.");
    await expect(summary.locator("a")).toHaveCount(0);
    expect(requests).toBe(1);
    await expectDraft(form, draft);
    await expect(form).not.toHaveAttribute("aria-busy", "true");
    for (const field of fields) await expect(form.locator(`#client-${field}`)).toBeEnabled();
    const failed = await withTestDatabase(pool => pool.query('SELECT count(*)::integer AS count FROM "Client"'));
    expect(failed.rows[0].count).toBe(1);
    await form.getByRole("button", { name: "Save client", exact: true }).click();
    await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(await clientRecord(id)).toEqual({ name: draft.name.trim(), phone: "+34611000313", email: draft.email.trim(), notes: draft.notes.trim() });
    expect(requests).toBe(2);
    const saved = await withTestDatabase(pool => pool.query('SELECT count(*)::integer AS count FROM "Client"'));
    expect(saved.rows[0].count).toBe(2);
  } finally { release(); }
});

test("phone contact selection respects cancellation and manual fields, with usable new and edit forms on mobile", async ({ page }, testInfo) => {
  await signUp(page);
  await seedClient("form-preview");
  await page.goto("/clients/new");
  const form = page.locator(".client-form");
  const chooseContact = form.getByRole("button", { name: "Choose from phone contacts", exact: true });
  const manualDraft = { name: "Elena Ríos", phone: "+34 611 000 314", email: "elena@example.test", notes: "Fine line botanical piece.\nBring the original placement reference." };
  await fillDraft(form, manualDraft);
  await captureForm(page, testInfo, "client-new");

  // These fixture-only navigator implementations make unsupported and permission outcomes deterministic.
  await page.evaluate(() => Object.defineProperty(navigator, "contacts", { configurable: true, value: undefined }));
  await chooseContact.click();
  await expect(form.getByRole("status")).toContainText("Phone contact selection is not available in this browser. Enter the client manually.");
  await expectDraft(form, manualDraft);
  await page.evaluate(() => Object.defineProperty(navigator, "contacts", {
    configurable: true, value: { select: async () => { throw new DOMException("Selection cancelled", "AbortError"); } },
  }));
  await chooseContact.click();
  await expect(form.getByRole("status")).toHaveCount(0);
  await expectDraft(form, manualDraft);
  await page.evaluate(() => Object.defineProperty(navigator, "contacts", { configurable: true, value: { select: async () => [] } }));
  await chooseContact.click();
  await expectDraft(form, manualDraft);
  await page.evaluate(() => Object.defineProperty(navigator, "contacts", {
    configurable: true, value: { select: async () => { throw new Error("Contact permission unavailable"); } },
  }));
  await chooseContact.click();
  await expect(form.getByRole("status")).toContainText("Could not read that contact. You can enter the client manually.");
  await expectDraft(form, manualDraft);
  await page.evaluate(() => Object.defineProperty(navigator, "contacts", {
    configurable: true, value: {
      select: async (properties: string[], options: { multiple: boolean }) => {
        if (properties.join(",") !== "name,tel" || options.multiple) throw new Error("Unexpected contact request");
        return [{ name: ["Aster Vega"], tel: ["+34 (611) 000-315"] }];
      },
    },
  }));
  await chooseContact.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(chooseContact).toBeFocused();
  expect(await chooseContact.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
  await page.keyboard.press("Enter");
  await expectDraft(form, { ...manualDraft, name: "Aster Vega", phone: "+34 (611) 000-315" });
  await expect(form.getByRole("status")).toHaveCount(0);
  await form.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/clients");
  await expect(page.locator(".client-list-item")).toHaveCount(1);
  await page.goto("/clients/form-preview/edit");
  await expectDraft(form, storedDraft);
  await captureForm(page, testInfo, "client-edit");
  await form.locator("#client-email").focus();
  await page.keyboard.press("Tab");
  await expect(form.locator("#client-notes")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Save client", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("link", { name: "Cancel", exact: true })).toBeFocused();
});
