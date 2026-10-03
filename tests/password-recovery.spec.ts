import { expect, test } from "./fixtures";

test("recovery handles absent and invalid tokens without changing a password", async ({ page }) => {
  await page.goto("/reset-password");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await expect(page.locator(".auth-card [role=alert]")).toContainText("invalid or has expired");
  await expect(page.locator(".auth-card [role=alert]")).toBeFocused();
  await expect(page.locator("#recovery-password")).toHaveCount(0);

  await page.goto("/reset-password?token=invalid-recovery-token");
  await page.locator("#recovery-password").fill("RecoveryCheck-2026!");
  await page.locator("#recovery-confirm").fill("DifferentPassword!");
  await page.locator(".auth-form button[type='submit']").click();
  await expect(page.locator(".auth-card [role=alert]")).toHaveText("The passwords do not match.");
  await page.locator("#recovery-confirm").fill("RecoveryCheck-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await expect(page.locator(".auth-card [role=alert]")).toContainText("invalid or has expired");
  await expect(page.locator("#recovery-password")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
});

test("recovery is explicit when email delivery is not configured", async ({ page }) => {
  test.skip(Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), "Do not send real mail while verifying UI.");
  await page.goto("/forgot-password");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await expect(page.getByRole("status")).toContainText("Email recovery is unavailable");
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.locator("#recovery-email")).toHaveCount(0);
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: "Forgot your password?" })).toHaveCount(0);
});
