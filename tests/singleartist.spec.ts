import { expect, test } from "./fixtures";
import { Pool } from "pg";

const password = "ArtistAccount-2026!";

test("simultaneous registration keeps one account per email and accepts different artists", async ({ browser }) => {
  const options = { baseURL: "http://127.0.0.1:3000", extraHTTPHeaders: { "x-forwarded-for": "10.20.0.1" } };
  const first = await browser.newContext(options);
  const second = await browser.newContext(options);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const results = await Promise.all([first, second].map(context => context.request.post("/api/auth/sign-up/email", {
      headers: { origin: options.baseURL }, data: { name: "Tattoo artist", email: "owner@example.com", password },
    })));
    expect(results.filter(response => response.ok())).toHaveLength(1);
    expect(results.filter(response => !response.ok())).toHaveLength(1);
    const duplicate = await pool.query('SELECT count(*)::int AS count FROM "user" WHERE email=$1', ["owner@example.com"]);
    expect(duplicate.rows[0].count).toBe(1);
    const distinct = await Promise.all([
      first.request.post("/api/auth/sign-up/email", { headers: { origin: options.baseURL, "x-forwarded-for": "10.20.0.3" }, data: { name: "Second artist", email: "second@example.com", password } }),
      second.request.post("/api/auth/sign-up/email", { headers: { origin: options.baseURL, "x-forwarded-for": "10.20.0.4" }, data: { name: "Third artist", email: "third@example.com", password } }),
    ]);
    for (const response of distinct) expect(response.status()).toBe(200);
    const artists = await pool.query('SELECT email FROM "user" ORDER BY email');
    expect(artists.rows).toEqual([{ email: "owner@example.com" }, { email: "second@example.com" }, { email: "third@example.com" }]);
    const workspaces = await pool.query('SELECT count(*)::int AS count FROM "WorkspaceRevision"');
    expect(workspaces.rows[0].count).toBe(3);
    await expect(pool.query('INSERT INTO "user" (id,name,email,"updatedAt") VALUES ($1,$2,$3,now())',
      ["duplicate-email-check", "Duplicate artist", "owner@example.com"])).rejects.toMatchObject({ code: "23505" });
  } finally {
    await Promise.all([first.close(), second.close(), pool.end()]);
  }
});

test("artist registration stays available and each artist reopens their own saved workspace", async ({ page, browser }) => {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("First tattoo artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill(password);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("First artist's private client");
  await page.locator("#client-phone").fill("+34600200001");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientPath = new URL(page.url()).pathname;

  const visitor = await browser.newContext({ baseURL: "http://127.0.0.1:3000", extraHTTPHeaders: { "x-forwarded-for": "10.20.0.2" } });
  try {
    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/sign-up");
    await expect(visitorPage).toHaveURL(/\/sign-up$/);
    await expect(visitorPage.locator("#name")).toBeVisible();
    expect((await visitor.request.get("/api/account/export")).status()).toBe(401);
    await visitorPage.goto("/sign-in");
    if (await visitorPage.locator(".auth-language .language-select").inputValue() !== "en") {
      await Promise.all([visitorPage.waitForEvent("load"), visitorPage.locator(".auth-language .language-select").selectOption("en")]);
    }
    const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
    const googleButton = visitorPage.getByRole("button", { name: "Sign in with Google", exact: true });
    await expect(googleButton).toBeVisible();
    if (googleConfigured) {
      await expect(googleButton).toBeEnabled();
      await expect(visitorPage.locator("#email")).toBeHidden();
    } else {
      await expect(googleButton).toBeDisabled();
      const explanation = visitorPage.locator(".google-auth-unavailable");
      await expect(explanation).toContainText("isn’t available yet");
      await expect(googleButton).toHaveAttribute("aria-describedby", await explanation.getAttribute("id") ?? "");
      await visitorPage.locator("#email").fill("owner@example.com");
      await visitorPage.locator("#password").fill(password);
      const emailOption = visitorPage.locator(".auth-email-option > summary");
      await emailOption.focus();
      await visitorPage.keyboard.press("Enter");
      await expect(visitorPage.locator("#email")).toBeHidden();
      await visitorPage.keyboard.press("Space");
      await expect(visitorPage.locator("#email")).toBeVisible();
      await expect(visitorPage.locator("#email")).toHaveValue("owner@example.com");
      await expect(visitorPage.locator("#password")).toHaveValue(password);
      await visitorPage.setViewportSize({ width: 360, height: 800 });
      expect(await visitorPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    await visitorPage.goto("/sign-in?error=oauth");
    await expect(visitorPage.locator(".auth-card [role=alert]")).toContainText(/Google/);
    const second = await visitor.request.post("/api/auth/sign-up/email", {
      headers: { origin: "http://127.0.0.1:3000" }, data: { name: "Second tattoo artist", email: "second@example.com", password },
    });
    expect(second.status()).toBe(200);
    await visitorPage.goto("/clients");
    await expect(visitorPage.locator(".client-list-item")).toHaveCount(0);
    expect((await visitorPage.goto(clientPath))?.status()).toBe(404);
    const secondExport = await visitor.request.get("/api/account/export");
    expect((await secondExport.json()).clients).toEqual([]);
  } finally { await visitor.close(); }

  await page.locator(".signout-button:visible").click();
  await page.waitForURL(url => url.pathname === "/sign-in");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill(password);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
  await page.goto(clientPath);
  await expect(page.locator("main")).toContainText("First artist's private client");
});
