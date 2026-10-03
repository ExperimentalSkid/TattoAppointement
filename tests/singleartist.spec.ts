import { expect, test } from "./fixtures";
import { Pool } from "pg";

async function assertSingleDatabaseOwner() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query('SELECT count(*)::int AS count FROM "user"');
    expect(result.rows[0].count).toBe(1);
    // The database rejects another email even if an application check is missed.
    await expect(pool.query('INSERT INTO "user" (id,name,email,"updatedAt") VALUES ($1,$2,$3,now())',
      ["extra-owner-check", "Second artist", "different@example.com"])).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query('INSERT INTO "user" (id,name,email,"ownerSlot","updatedAt") VALUES ($1,$2,$3,$4,now())',
      ["extra-slot-check", "Second artist", "different@example.com", "another-owner"])).rejects.toMatchObject({ code: "23514" });
  } finally {
    await pool.end();
  }
}

test("simultaneous owner bootstrap creates exactly one account", async ({ browser }) => {
  const options = { baseURL: "http://127.0.0.1:3000", extraHTTPHeaders: { "x-forwarded-for": "10.20.0.1" } };
  const first = await browser.newContext(options);
  const second = await browser.newContext(options);
  try {
    const results = await Promise.all([first, second].map((context) => context.request.post("/api/auth/sign-up/email", {
      data: { name: "Studio owner", email: "owner@example.com", password: "OwnerAccount-2026!" },
    })));
    expect(results.filter((response) => response.ok())).toHaveLength(1);
    expect(results.filter((response) => !response.ok())).toHaveLength(1);
    await assertSingleDatabaseOwner();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("one artist owns the installation and later account creation stays closed", async ({ page, browser }) => {
  const ownerEmail = "owner@example.com";
  const ownerPassword = "OwnerAccount-2026!";
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  const wrongFirst = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Unauthorized first account", email: "other@example.com", password: ownerPassword },
  });
  expect(wrongFirst.ok()).toBe(false);
  await page.locator("#name").fill("Studio owner");
  await page.locator("#email").fill(ownerEmail);
  await page.locator("#password").fill(ownerPassword);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL((url) => url.pathname === "/calendar");

  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:3000", extraHTTPHeaders: { "x-forwarded-for": "10.20.0.2" } });
  const attempts = await Promise.all(["other@example.com", ownerEmail, "another@example.com"].map((email) => anonymous.request.post("/api/auth/sign-up/email", {
    data: { name: "Additional account", email, password: ownerPassword },
  })));
  for (const response of attempts) expect(response.ok()).toBe(false);
  await assertSingleDatabaseOwner();

  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto("/sign-up");
  await expect(anonymousPage).toHaveURL(/\/sign-in/);
  await expect(anonymousPage.locator("a[href='/sign-up']")).toHaveCount(0);
  if (await anonymousPage.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([anonymousPage.waitForEvent("load"), anonymousPage.locator(".auth-language .language-select").selectOption("en")]);
  }
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  const googleButton = anonymousPage.getByRole("button", { name: "Sign in with Google", exact: true });
  await expect(googleButton).toBeVisible();
  if (googleConfigured) {
    await expect(googleButton).toBeEnabled();
    await expect(anonymousPage.locator("#email")).toBeHidden();
  } else {
    await expect(googleButton).toBeDisabled();
    const explanation = anonymousPage.locator(".google-auth-unavailable");
    await expect(explanation).toContainText("isn’t available yet");
    await expect(googleButton).toHaveAttribute("aria-describedby", await explanation.getAttribute("id") ?? "");
    await anonymousPage.locator("#email").fill(ownerEmail);
    await anonymousPage.locator("#password").fill(ownerPassword);
    const emailOption = anonymousPage.locator(".auth-email-option > summary");
    await emailOption.focus();
    await anonymousPage.keyboard.press("Enter");
    await expect(anonymousPage.locator("#email")).toBeHidden();
    await anonymousPage.keyboard.press("Space");
    await expect(anonymousPage.locator("#email")).toBeVisible();
    await expect(anonymousPage.locator("#email")).toHaveValue(ownerEmail);
    await expect(anonymousPage.locator("#password")).toHaveValue(ownerPassword);
    await anonymousPage.setViewportSize({ width: 360, height: 800 });
    expect(await anonymousPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await anonymousPage.goto("/sign-in?error=oauth");
  await expect(anonymousPage.locator(".auth-card [role=alert]")).toContainText(/Google/);
  expect((await anonymous.request.get("/api/account/export")).status()).toBe(401);
  await anonymous.close();

  await page.locator(".signout-button:visible").click();
  await page.waitForURL((url) => url.pathname === "/sign-in");
  await page.locator("#email").fill(ownerEmail);
  await page.locator("#password").fill(ownerPassword);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL((url) => url.pathname === "/calendar");
  await expect(page.locator(".app-content")).toBeVisible();
});
