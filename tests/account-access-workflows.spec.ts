import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { Pool } from "pg";

const artist = { name: "Account access QA artist", email: "owner@example.com", password: "Account-Access-QA-2026!" };

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Account-access fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function selectEnglish(page: Page) {
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  }
}

async function fillArtistSignup(page: Page) {
  await page.goto("/sign-up");
  await selectEnglish(page);
  await page.locator("#name").fill(artist.name);
  await page.locator("#email").fill(artist.email);
  await page.locator("#password").fill(artist.password);
}

async function signUp(page: Page) {
  await fillArtistSignup(page);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function signOut(page: Page) {
  await page.locator(".signout-button:visible").click();
  await page.waitForURL(url => url.pathname === "/sign-in");
}

async function expectGenericAuthError(form: Locator, message: string) {
  const feedback = form.locator("#auth-error[role='alert']");
  await expect(feedback).toHaveText(message);
  await expect(feedback).toBeFocused();
  for (const field of ["email", "password"]) {
    await expect(form.locator(`#${field}`)).not.toHaveAttribute("aria-invalid", "true");
    expect(await form.locator(`#${field}`).evaluate(element => (element.getAttribute("aria-describedby") ?? "").split(/\s+/))).not.toContain("auth-error");
  }
}

test("successful signup and sign-in reach the workspace when saving the language preference fails", async ({ page }) => {
  await fillArtistSignup(page);
  let phase: "connection" | "server" = "connection";
  const preferences: string[] = [];
  await page.route("**/api/preferences/language", async route => {
    preferences.push(route.request().postDataJSON().language);
    if (phase === "connection") await route.abort("failed");
    else await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"unavailable"}' });
  });
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  await expect(page.locator(".app-content")).toBeVisible();
  expect(preferences).toEqual(["en"]);
  const owner = await withTestDatabase(pool => pool.query('SELECT name,email,language FROM "user"'));
  expect(owner.rows).toEqual([{ name: artist.name, email: artist.email, language: "es" }]);

  await signOut(page);
  await page.goto("/sign-up");
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.locator("#name")).toBeVisible();
  await page.goto("/sign-in");
  phase = "server";
  await page.locator("#email").fill(artist.email);
  await page.locator("#password").fill(artist.password);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  await expect(page.locator(".app-content")).toBeVisible();
  expect(preferences).toEqual(["en", "es"]);
  const stillOneArtist = await withTestDatabase(pool => pool.query('SELECT count(*)::integer AS count FROM "user"'));
  expect(stillOneArtist.rows[0].count).toBe(1);
});

test("sign-in preserves credentials after failure, focuses safe feedback and locks duplicate pending submissions", async ({ page }) => {
  await signUp(page);
  await signOut(page);
  await selectEnglish(page);
  const form = page.locator(".auth-form");
  const email = form.locator("#email");
  const password = form.locator("#password");
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(password).toHaveAttribute("minlength", "8");
  await expect(password).toHaveAttribute("maxlength", "128");
  await email.fill(artist.email);
  await password.fill(artist.password);

  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await password.focus();
    await page.keyboard.press("Tab");
    const reveal = form.getByRole("button", { name: "Show password", exact: true });
    await expect(reveal).toBeFocused();
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "text");
    await expect(form.getByRole("button", { name: "Hide password", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue(artist.password);
  }

  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/auth/sign-in/email", async route => {
    requests += 1;
    if (requests === 1) { await gate; await route.abort("failed"); }
    else await route.continue();
  });
  try {
    // Both native submissions happen before React can paint the disabled controls.
    await form.evaluate(element => {
      const authForm = element as HTMLFormElement;
      authForm.requestSubmit();
      authForm.requestSubmit();
    });
    const pending = form.getByRole("button", { name: "Please wait…", exact: true });
    await expect(pending).toBeDisabled();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(email).toBeDisabled();
    await expect(password).toBeDisabled();
    await expect(form.getByRole("button", { name: "Show password", exact: true })).toBeDisabled();
    const bounds = await pending.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await expect.poll(() => requests).toBe(1);
    release();
    await expectGenericAuthError(form, "Could not connect. Check your connection and try again.");
    await expect(email).toHaveValue(artist.email);
    await expect(password).toHaveValue(artist.password);
    await expect(email).toBeEnabled();
    await expect(password).toBeEnabled();
    await expect(form).toHaveAttribute("aria-busy", "false");
    expect(requests).toBe(1);

    await password.fill("Incorrect-Account-QA-2026!");
    await expect(form.locator("#auth-error")).toHaveCount(0);
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await expectGenericAuthError(form, "Could not sign in with those details.");
    await expect(email).toHaveValue(artist.email);
    await expect(password).toHaveValue("Incorrect-Account-QA-2026!");
    await password.fill(artist.password);
    await expect(form.locator("#auth-error")).toHaveCount(0);
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/calendar");
    await expect(page.locator(".app-content")).toBeVisible();
    expect(requests).toBe(3);
  } finally { release(); }
});

test("password recovery focuses matching errors and safely ends an invalid token attempt after one pending request", async ({ page }) => {
  await signUp(page);
  await signOut(page);
  await page.goto("/reset-password?token=invalid-account-access-token");
  await selectEnglish(page);
  const form = page.locator(".auth-form");
  const password = form.locator("#recovery-password");
  const confirm = form.locator("#recovery-confirm");
  for (const field of [password, confirm]) {
    await expect(field).toHaveAttribute("autocomplete", "new-password");
    await expect(field).toHaveAttribute("minlength", "8");
    await expect(field).toHaveAttribute("maxlength", "128");
  }
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await password.fill("Recovery-Access-QA-2026!");
  await confirm.fill("Different-Recovery-QA-2026!");
  await confirm.focus();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Save new password", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const feedback = form.locator("#recovery-reset-error[role='alert']");
  await expect(feedback).toHaveText("The passwords do not match.");
  await expect(feedback).toBeFocused();
  await expect(confirm).toHaveAttribute("aria-invalid", "true");
  expect(await confirm.evaluate(element => (element.getAttribute("aria-describedby") ?? "").split(/\s+/))).toContain("recovery-reset-error");
  await expect(password).not.toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveValue("Recovery-Access-QA-2026!");
  await expect(confirm).toHaveValue("Different-Recovery-QA-2026!");
  await confirm.fill("Recovery-Access-QA-2026!");
  await expect(feedback).toHaveCount(0);
  await expect(confirm).not.toHaveAttribute("aria-invalid", "true");

  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/auth/reset-password", async route => { requests += 1; await gate; await route.continue(); });
  try {
    await form.evaluate(element => {
      const recoveryForm = element as HTMLFormElement;
      recoveryForm.requestSubmit();
      recoveryForm.requestSubmit();
    });
    await expect(form).toHaveAttribute("aria-busy", "true");
    const pending = form.getByRole("button", { name: "Saving…", exact: true });
    await expect(pending).toBeDisabled();
    await expect(password).toBeDisabled();
    await expect(confirm).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    release();
    await expect(feedback).toHaveText("This recovery link is invalid or has expired. Request a new link to continue.");
    await expect(feedback).toBeFocused();
    await expect(password).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    await expect(form.locator("button[type='submit']")).toHaveCount(0);
    await expect(form.getByRole("link", { name: "Request a new link", exact: true })).toHaveAttribute("href", "/forgot-password");
    expect(requests).toBe(1);
  } finally { release(); }

  await page.goto("/sign-in");
  await page.locator("#email").fill(artist.email);
  await page.locator("#password").fill(artist.password);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  await expect(page.locator(".app-content")).toBeVisible();
});
