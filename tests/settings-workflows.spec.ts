import { expect, test } from "./fixtures";
import type { Download, Locator, Page } from "@playwright/test";
import { Pool } from "pg";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const defaultReminder = "Hi {client}, a reminder about your tattoo appointment on {date} at {time} at {studio}. See you soon!";

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Settings-workflow fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function signUp(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Settings QA artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Settings-Workflows-QA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  await page.goto("/settings");
}

async function expectAssociatedError(form: Locator, field: Locator, message: string) {
  const summary = form.locator(".appointment-error-summary[role='alert']");
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("Check the settings");
  await expect(summary).toContainText(message);
  await summary.locator(`a[href='#${await field.getAttribute("id")}']`).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(await field.evaluate(element => (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" "))).toContain(message);
}

async function selectText(field: Locator, start: number, end = start) {
  await field.focus();
  // Fixture-only selection sets a precise caret without changing application state.
  await field.evaluate((element, selection) => (element as HTMLTextAreaElement).setSelectionRange(selection.start, selection.end), { start, end });
}

async function expectCaret(field: Locator, index: number) {
  await expect(field).toBeFocused();
  expect(await field.evaluate(element => {
    const text = element as HTMLTextAreaElement;
    return [text.selectionStart, text.selectionEnd];
  })).toEqual([index, index]);
}

test("studio identity preserves rejected edits, focuses field errors and tracks the last saved baseline", async ({ page }) => {
  await signUp(page);
  const form = page.locator(".studio-settings-form");
  const artist = form.locator("#artist-name");
  const studio = form.locator("#studio-name");
  await expect(form.getByText("Unsaved changes.", { exact: true })).toHaveCount(0);
  await expect(form.locator("#artist-email")).toHaveAttribute("readonly", "");

  const rawStudio = "  Atelier Ámbar  ";
  await artist.fill("   ");
  await studio.fill(rawStudio);
  await expect(form.getByText("Unsaved changes.", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expectAssociatedError(form, artist, "Enter a valid name of up to 80 characters.");
  await expect(artist).toHaveValue("   ");
  await expect(studio).toHaveValue(rawStudio);

  const rawArtist = "  Renée Ink  ";
  const oversizedStudio = "S".repeat(81);
  // Remove only the disposable browser's cap to verify the real server validation.
  await studio.evaluate(element => element.removeAttribute("maxlength"));
  await artist.fill(rawArtist);
  await studio.fill(oversizedStudio);
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expectAssociatedError(form, studio, "Use a studio name of up to 80 characters on a single line.");
  await expect(artist).toHaveValue(rawArtist);
  await expect(studio).toHaveValue(oversizedStudio);
  const rejectedProfile = await withTestDatabase(pool => pool.query('SELECT name,"studioName" FROM "user" WHERE email=$1', ["owner@example.com"]));
  expect(rejectedProfile.rows[0]).toEqual({ name: "Settings QA artist", studioName: null });

  await studio.fill(rawStudio);
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(form.getByRole("status")).toHaveText("Changes saved. Your workspace is up to date.");
  await expect(artist).toHaveValue("Renée Ink");
  await expect(studio).toHaveValue("Atelier Ámbar");
  await expect(form.getByText("Unsaved changes.", { exact: true })).toHaveCount(0);
  await expect(page.locator("#whatsapp-reminder-preview")).toContainText("Atelier Ámbar");

  await studio.fill("A new draft studio");
  await expect(form.getByText("Unsaved changes.", { exact: true })).toBeVisible();
  await expect(form.locator(".settings-success")).toHaveCount(0);
  await page.reload();
  await expect(artist).toHaveValue("Renée Ink");
  await expect(studio).toHaveValue("Atelier Ámbar");
  await expect(form.getByText("Unsaved changes.", { exact: true })).toHaveCount(0);

  // Removing the optional studio name is a valid save; the preview uses the artist name.
  await studio.fill("");
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Changes saved.");
  await expect(page.locator("#whatsapp-reminder-preview")).toContainText("Renée Ink");
  await page.reload();
  await expect(studio).toHaveValue("");
  await expect(page.locator("#whatsapp-reminder-preview")).toContainText("Renée Ink");
});

test("reminder tokens replace the selection, restore the caret and support bounded drafts with reset undo", async ({ page }) => {
  await signUp(page);
  const form = page.locator(".reminder-settings-form");
  const message = form.locator("#whatsapp-reminder-template");
  await expect(message).toHaveAttribute("maxlength", "2000");
  await expect(message).toHaveValue(defaultReminder);
  for (const token of ["client", "date", "time", "studio"]) {
    await expect(form.getByRole("button", { name: `Insert {${token}}`, exact: true })).toBeVisible();
  }

  const base = "Hi NAME, at {studio}.";
  await message.fill(base);
  await selectText(message, 3, 7);
  await form.getByRole("button", { name: "Insert {client}", exact: true }).click();
  await expect(message).toHaveValue("Hi {client}, at {studio}.");
  await expectCaret(message, 11);
  // Keyboard activation must keep the selection captured before focus moved to the token.
  const dateToken = form.getByRole("button", { name: "Insert {date}", exact: true });
  await dateToken.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(dateToken).toBeFocused();
  expect(await dateToken.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
  await page.keyboard.press("Enter");
  await expect(message).toHaveValue("Hi {client}{date}, at {studio}.");
  await expectCaret(message, 17);

  await message.fill("M".repeat(1995));
  await selectText(message, 1995);
  await form.getByRole("button", { name: "Insert {client}", exact: true }).click();
  await expect(message).toHaveValue("M".repeat(1995));
  await expect(form).toContainText("There isn’t enough room for this field. Shorten the message first.");
  await message.fill("M".repeat(1992));
  await selectText(message, 1992);
  await form.getByRole("button", { name: "Insert {client}", exact: true }).click();
  await expect(message).toHaveValue(`${"M".repeat(1992)}{client}`);
  await expectCaret(message, 2000);

  const invalidDraft = "  Hello {client},\nKeep my spacing {duration}.  ";
  await message.fill(invalidDraft);
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expectAssociatedError(form, message, "Use only {client}, {date}, {time} and {studio}, with complete braces.");
  await expect(message).toHaveValue(invalidDraft);
  await form.getByRole("button", { name: "Use default message", exact: true }).click();
  await expect(message).toHaveValue(defaultReminder);
  await expect(form).toContainText("Default message applied. Save changes to keep it.");
  await form.getByRole("button", { name: "Undo reset", exact: true }).click();
  await expect(message).toHaveValue(invalidDraft);
  await expect(form.getByRole("button", { name: "Undo reset", exact: true })).toHaveCount(0);

  const rawTemplate = "  Hola {client},\nAt {studio}, {date} {time}.  ";
  await message.fill(rawTemplate);
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(form.locator(".settings-success[role='status']")).toHaveText("Reminder template saved.");
  await expect(message).toHaveValue(rawTemplate.trim());
  await expect(form.getByText("Unsaved changes.", { exact: true })).toHaveCount(0);
  await message.fill(`${rawTemplate.trim()} A draft sentence.`);
  await expect(form.getByText("Unsaved changes.", { exact: true })).toBeVisible();
  await expect(form.locator(".settings-success")).toHaveCount(0);
  const pendingDraft = await message.inputValue();
  await form.getByRole("button", { name: "Use default message", exact: true }).click();
  await form.getByRole("button", { name: "Undo reset", exact: true }).click();
  await expect(message).toHaveValue(pendingDraft);
  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(message).toHaveValue(pendingDraft);
  await expect(form.getByRole("button", { name: "Insertar {client}", exact: true })).toBeVisible();
  await page.locator(".app-topbar .language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(message).toHaveValue(pendingDraft);
  await expect(form.getByText("Unsaved changes.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(message).toHaveValue(rawTemplate.trim());
  await expect(form.getByText("Unsaved changes.", { exact: true })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Undo reset", exact: true })).toHaveCount(0);
});

test("private account export handles pending requests and failed responses before retrying a real JSON download", async ({ page, browser }, testInfo) => {
  await signUp(page);
  const upload = await page.request.post("/api/designs", {
    multipart: { title: "Settings export tattoo reference", image: { name: "settings-export.png", mimeType: "image/png", buffer: png } },
  });
  expect(upload.status()).toBe(201);
  const designId = (await upload.json()).id as string;
  const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await withTestDatabase(async pool => {
    const owner = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    expect(owner.rows).toHaveLength(1);
    const artistId = owner.rows[0].id;
    await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,notes,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["settings-export-client", artistId, "Export QA client", "+34611000977", "Owned client notes"]);
    await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"agreedPrice","updatedAt") VALUES ($1,$2,$3,$4,120,\'CONFIRMED\',250,now())', ["settings-export-appointment", artistId, "settings-export-client", startsAt]);
    await pool.query('INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") VALUES ($1,$2,true)', ["settings-export-appointment", designId]);
    await pool.query('INSERT INTO "Payment" (id,"artistId","appointmentId",amount,"receivedAt") VALUES ($1,$2,$3,25.50,now())', ["settings-export-payment", artistId, "settings-export-appointment"]);
  });

  let requests = 0;
  let phase: "unauthorized" | "server-error" | "invalid-json" | "invalid-export" | "success" = "unauthorized";
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  const downloads: Download[] = [];
  page.on("download", download => { downloads.push(download); });
  await page.route("**/api/account/export", async route => {
    requests += 1;
    if (phase === "unauthorized") {
      await firstResponse;
      await route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' });
    } else if (phase === "server-error") {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"unavailable"}' });
    } else if (phase === "invalid-json") {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"profile":' });
    } else if (phase === "invalid-export") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, currency: "EUR", timeZone: "Europe/Madrid", profile: {}, clients: [], designs: [], appointments: [], payments: [] }) });
    } else {
      await route.continue();
    }
  });
  const exportButton = page.locator(".account-export-button");
  try {
    await exportButton.click();
    await expect(exportButton).toHaveAccessibleName("Preparing download…");
    await expect(exportButton).toBeDisabled();
    await expect(page.locator("#account-export-status")).toHaveText("Preparing download…");
    // A second physical pointer activation while disabled cannot create another export.
    const bounds = await exportButton.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await expect.poll(() => requests).toBe(1);
    expect(downloads).toHaveLength(0);
    releaseFirst();
    await expect(page.locator("#account-export-error")).toHaveText("The download could not be prepared. Try again.");
    await expect(exportButton).toHaveAccessibleName("Retry download");
    await expect(exportButton).toBeEnabled();
    expect(downloads).toHaveLength(0);
    for (const failure of ["server-error", "invalid-json", "invalid-export"] as const) {
      phase = failure;
      await exportButton.click();
      await expect(page.locator("#account-export-error")).toHaveText("The download could not be prepared. Try again.");
      await expect(exportButton).toHaveAccessibleName("Retry download");
      expect(downloads).toHaveLength(0);
    }
    expect(requests).toBe(4);
    phase = "success";
    const downloadReady = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadReady;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/^tinta-data-\d{4}-\d{2}-\d{2}\.json$/);
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(data).toMatchObject({ version: 1, currency: "EUR", timeZone: "Europe/Madrid", profile: { name: "Settings QA artist", email: "owner@example.com" } });
    expect(data.clients).toHaveLength(1);
    expect(data.clients[0]).toMatchObject({ id: "settings-export-client", name: "Export QA client", notes: "Owned client notes" });
    expect(data.designs).toHaveLength(1);
    expect(data.designs[0]).toMatchObject({ id: designId, title: "Settings export tattoo reference" });
    expect(data.appointments).toHaveLength(1);
    expect(data.appointments[0]).toMatchObject({ id: "settings-export-appointment", startsAt, status: "CONFIRMED", designs: [{ designId, isFinal: true }] });
    expect(data.payments).toHaveLength(1);
    expect(data.payments[0]).toMatchObject({ id: "settings-export-payment", amount: "25.5" });
    for (const privateKey of ["password", "sessions", "accounts", "accessToken"]) expect(data.profile).not.toHaveProperty(privateKey);
    expect(data.designs[0]).not.toHaveProperty("storageKey");
    expect(data.designs[0]).not.toHaveProperty("previewKey");
    await expect(page.locator("#account-export-status")).toHaveText("Download started.");
    await expect(page.locator("#account-export-error")).toHaveCount(0);
    await expect(exportButton).toHaveAccessibleName("Download my data");
    await expect(exportButton).toBeEnabled();
    expect(requests).toBe(5);
    expect(downloads).toHaveLength(1);
  } finally { releaseFirst(); }

  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const visitor = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  try { expect((await visitor.request.get("/api/account/export")).status()).toBe(401); } finally { await visitor.close(); }

  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(exportButton).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.locator("main").focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = testInfo.outputPath(`settings-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`settings-${viewport.width}`, { path: screenshot, contentType: "image/png" });
  }
});
