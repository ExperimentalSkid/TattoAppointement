import { expect, test } from "./fixtures";
import { type Page } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("private uploads and concurrent appointment saves remain guarded", async ({ page, context }) => {
  const anonymousImage = await page.request.get("/api/designs/missing/image");
  expect(anonymousImage.status()).toBe(401);
  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ready" });

  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Server validation artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("ServerCheck-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL((url) => url.pathname === "/calendar");

  const malformed = await page.request.post("/api/designs", { data: "not multipart", headers: { "Content-Type": "text/plain" } });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual({ error: "invalid_body" });
  const rejectedOrigin = await page.request.post("/api/designs", { headers: { Origin: "https://other.example" } });
  expect(rejectedOrigin.status()).toBe(403);

  const upload = await page.request.post("/api/designs", {
    multipart: { title: "Concurrent session design", image: { name: "design.png", mimeType: "image/png", buffer: png } },
  });
  expect(upload.status()).toBe(201);
  const { id } = await upload.json();
  const image = await page.request.get(`/api/designs/${id}/image`);
  expect(image.status()).toBe(200);
  expect(image.headers()["cache-control"]).toContain("no-store");

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Concurrent session client");
  await page.locator("#client-phone").fill("+34600111222");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);

  const otherPage = await context.newPage();
  async function fillAppointment(target: Page) {
    await target.goto("/new-appointment");
    await target.locator("#appointment-client").selectOption({ index: 1 });
    await target.locator("#appointment-start").fill("2027-10-05T10:00");
    await target.locator("#appointment-duration").fill("120");
    await target.locator("input[name='designIds']").first().check();
    await target.locator("#agreed-price").fill("350.00");
    await target.locator("#deposit-required").fill("100.00");
    await target.locator("#initial-payment").fill("0.00");
  }
  await Promise.all([fillAppointment(page), fillAppointment(otherPage)]);
  await Promise.all([page, otherPage].map((target) => target.locator(".appointment-form button[type='submit']").click()));

  await expect.poll(async () => {
    const outcomes = await Promise.all([page, otherPage].map(async (target) => {
      if (/\/appointments\/[A-Za-z0-9_-]+$/.test(new URL(target.url()).pathname)) return "saved";
      if (await target.locator(".overlap-warning").isVisible()) return "overlap";
      return "pending";
    }));
    return outcomes.sort();
  }).toEqual(["overlap", "saved"]);
  await otherPage.close();
});
