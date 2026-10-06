import { expect, test } from "./fixtures";

test("Spanish onboarding, studio settings, bilingual persistence and private export", async ({ page, browser }) => {
  await page.goto("/sign-up");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.locator("#name").fill("Marina Ortega");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Studio-Test-2026!");
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await page.locator(".auth-form button[type=submit]").click();
  await page.waitForURL(/\/calendar/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  await page.goto("/settings");
  await page.locator("#studio-name").fill("Línea Clara Tattoo");
  await page.locator("#artist-name").fill("Marina O.");
  await page.locator(".studio-settings-form button[type=submit]").click();
  await expect(page.getByRole("status").filter({ hasText: /guardad/i })).toBeVisible();
  await page.reload();
  await expect(page.locator("#studio-name")).toHaveValue("Línea Clara Tattoo");
  await expect(page.locator(".topbar-app-name")).toHaveText("Línea Clara Tattoo");

  await page.locator(".app-topbar .language-select").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#studio-name")).toHaveValue("Línea Clara Tattoo");

  const exportResponse = await page.request.get("/api/account/export");
  expect(exportResponse.status()).toBe(200);
  expect(exportResponse.headers()["cache-control"]).toContain("no-store");
  const json = await exportResponse.json();
  expect(JSON.stringify(json)).toContain("Línea Clara Tattoo");
  expect(JSON.stringify(json)).not.toMatch(/"(?:password|token|secret)"/);

  const anotherSession = await browser.newContext();
  const signedIn = await anotherSession.request.post("http://127.0.0.1:3000/api/auth/sign-in/email", { data: { email: "owner@example.com", password: "Studio-Test-2026!" } });
  expect(signedIn.ok()).toBe(true);
  await page.locator("#current-password").fill("incorrect-current-password");
  await page.locator("#new-password").fill("Changed-Studio-2026!");
  await page.locator("#confirm-password").fill("Changed-Studio-2026!");
  await page.locator(".password-settings-form button[type=submit]").click();
  await expect(page.locator(".password-settings-form [role=alert]")).toContainText("current password");
  await page.locator("#current-password").fill("Studio-Test-2026!");
  await page.locator("#new-password").fill("Changed-Studio-2026!");
  await page.locator("#confirm-password").fill("Changed-Studio-2026!");
  await page.locator(".password-settings-form button[type=submit]").click();
  await expect(page.locator(".password-settings-form [role=status]")).toContainText("Password changed");
  const oldSession = await anotherSession.request.get("http://127.0.0.1:3000/api/auth/get-session");
  expect(await oldSession.json()).toBeNull();
  await anotherSession.close();
  const anon = await browser.newContext();
  const denied = await anon.request.get("http://127.0.0.1:3000/api/account/export");
  expect(denied.status()).toBe(401);
  await anon.close();
});

test("auth and private workspace fit narrow screens with accessible navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/sign-up");
  await page.locator("#name").fill("Design QA");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Studio-Test-2026!");
  await page.locator(".auth-form button[type=submit]").click();
  await page.waitForURL(/\/calendar/);
  for (const width of [320, 390, 820, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/calendar?view=month&anchor=2026-10-01", "/clients", "/designs", "/settings"]) {
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width} ${route}`).toBeLessThanOrEqual(1);
      await expect(page.locator("h1")).toHaveCount(1);
      const navigation = page.locator(width >= 800 ? ".desktop-nav" : ".mobile-nav");
      await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
    }
  }
  expect(errors).toEqual([]);
});

test("login handles network failure and can be retried", async ({ page }) => {
  await page.goto("/sign-in");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Studio-Test-2026!");
  await page.route("**/api/auth/sign-in/email", route => route.abort("failed"));
  await page.locator(".auth-form button[type=submit]").click();
  await expect(page.locator(".auth-card [role=alert]")).toBeVisible();
  await expect(page.locator(".auth-form button[type=submit]")).toBeEnabled();
});
