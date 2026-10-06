import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fillAppointmentStart } from "./appointment-helpers";

const origin = "http://127.0.0.1:3000";

async function payments(page: Page) {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  return (await response.json()).payments as { id: string; amount: string; appointmentId: string }[];
}

async function paymentAppointment(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin },
    data: { name: "Committed payment recovery artist", email: "payment-response@example.com", password: "Payment-Response-Recovery-2026!" },
  });
  expect(signup.status()).toBe(200);
  expect((await page.request.post("/api/preferences/language", { headers: { origin }, data: { language: "en" } })).status()).toBe(200);
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Committed payment client");
  await page.locator("#client-phone").fill("+34611009802");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  await page.goto("/new-appointment?date=2027-11-06");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await fillAppointmentStart(page, "2027-11-06T10:00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const path = new URL(page.url()).pathname;
  expect(await payments(page)).toEqual([]);
  return path;
}

test("retrying a payment after its committed response is lost records it once and allows a later identical payment", async ({ page }, info) => {
  const path = await paymentAppointment(page);
  const appointmentId = path.split("/").at(-1)!;

  let requests = 0;
  let committedResponseLost = false;
  await page.route(url => url.origin === origin && url.pathname === path, async route => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      requests += 1;
      if (requests === 1) {
        // Forward this genuine form submission and finish reading its response.
        // The write has completed before only the browser's response is dropped.
        const response = await route.fetch({ maxRedirects: 0 });
        expect(response.status()).toBe(200);
        await response.body();
        expect(await payments(page)).toEqual([expect.objectContaining({ appointmentId, amount: "25.5" })]);
        committedResponseLost = true;
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });

  const form = page.locator(".payment-entry-form");
  await page.locator("#payment-amount").fill("25.50");
  await form.locator("button[type='submit']").click();
  await expect.poll(() => committedResponseLost).toBe(true);
  const firstPayment = await payments(page);
  expect(firstPayment).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("committed-payment-response-lost.png"), fullPage: true });
  await info.attach("committed-payment-response-lost", {
    body: JSON.stringify({ committedResponseLost, submittedRequests: requests, savedPayments: firstPayment.length }, null, 2),
    contentType: "application/json",
  });
  await expect(form).toBeVisible();
  await expect(form.locator("[role='alert']")).toContainText("Could not record the payment.");
  await expect(page.locator("#payment-amount")).toHaveValue("25.50");
  await expect(form.locator("button[type='submit']")).toBeEnabled();

  await form.locator("button[type='submit']").click();
  await expect(form.locator("[role='status']")).toHaveText("Payment recorded.");
  await expect(page.locator("#payment-amount")).toHaveValue("");
  expect(requests).toBe(2);
  // A retry acknowledges the original entry rather than creating another one.
  expect(await payments(page)).toEqual(firstPayment);
  await expect(page.locator(".payment-history-list li")).toHaveCount(1);

  // Two legitimate receipts can have the same amount. A new successful form
  // submission must receive a fresh identity after the previous one completes.
  await page.locator("#payment-amount").fill("25.50");
  await form.locator("button[type='submit']").click();
  await expect(page.locator("#payment-amount")).toHaveValue("");
  await expect(page.locator(".payment-history-list li")).toHaveCount(2);
  const finalPayments = await payments(page);
  expect(finalPayments).toHaveLength(2);
  expect(finalPayments.map(payment => payment.amount)).toEqual(["25.5", "25.5"]);
  expect(new Set(finalPayments.map(payment => payment.id)).size).toBe(2);
  expect(requests).toBe(3);
});

test("concurrent copies of one genuine payment submission both succeed with one receipt and one revision increment", async ({ page }) => {
  const path = await paymentAppointment(page);
  const appointmentId = path.split("/").at(-1)!;
  const syncBefore = await page.request.get("/api/workspace/sync");
  expect(syncBefore.status()).toBe(200);
  const revisionBefore = BigInt((await syncBefore.json()).revision);
  let duplicated = false;
  await page.route(url => url.origin === origin && url.pathname === path, async route => {
    if (!duplicated && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      duplicated = true;
      // Replay the exact real UI payload concurrently without constructing a
      // Server Action ID, credentials or a separate receipt identity.
      const responses = await Promise.all([route.fetch({ maxRedirects: 0 }), route.fetch({ maxRedirects: 0 })]);
      for (const response of responses) {
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain('"success":true');
      }
      await route.fulfill({ response: responses[0] });
      return;
    }
    await route.continue();
  });
  await page.locator("#payment-amount").fill("25.50");
  await page.locator(".payment-entry-form button[type='submit']").click();
  await expect(page.locator(".payment-entry-form [role='status']")).toHaveText("Payment recorded.");
  expect(duplicated).toBe(true);
  expect(await payments(page)).toEqual([expect.objectContaining({ appointmentId, amount: "25.5" })]);
  await expect(page.locator(".payment-history-list li")).toHaveCount(1);
  const syncAfter = await page.request.get("/api/workspace/sync");
  expect(syncAfter.status()).toBe(200);
  expect(BigInt((await syncAfter.json()).revision)).toBe(revisionBefore + BigInt(1));
});
