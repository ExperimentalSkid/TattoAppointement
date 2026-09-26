import { expect, test } from "@playwright/test";

test("installable PWA metadata and asset service worker are available", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  const manifest = (await manifestResponse.json()) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
  };

  expect(manifest.name).toBe("Tattoo Appointment");
  expect(manifest.short_name).toBe("Tattoo");
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons?.some((icon) => icon.sizes === "192x192")).toBe(true);
  expect(manifest.icons?.some((icon) => icon.sizes === "512x512")).toBe(true);

  const iconResponse = await page.request.get("/icons/app-icon.svg");
  expect(iconResponse.status()).toBe(200);

  const workerResponse = await page.request.get("/sw.js");
  expect(workerResponse.status()).toBe(200);

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return false;
          return Boolean(await navigator.serviceWorker.getRegistration());
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
});
