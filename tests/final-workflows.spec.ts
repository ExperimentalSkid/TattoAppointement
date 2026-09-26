import { expect, test, type Browser, type Page } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function signUp(page: Page, email: string, name = "Final QA Artist") {
  await page.goto("/sign-up");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("FinalQA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar$/);
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("FinalQA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar$/);
}

async function createClient(page: Page, unique: string) {
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Final QA Client");
  await page.locator("#client-phone").fill(`+34 611 ${unique.slice(-3)} 001`);
  await page.locator("#client-email").fill(`client-${unique}@example.com`);
  await page.locator("#client-notes").fill("Final QA persistent client notes");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function createDesign(page: Page) {
  await page.goto("/designs/new");
  await page.locator("#design-image").setInputFiles({
    name: "final-qa-design.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.locator("#design-title").fill("Final QA Design");
  await page.locator("#design-notes").fill("Reusable final QA design");
  await page.locator(".design-form button[type='submit']").click();
  await page.waitForURL(/\/designs\/(?!new$)[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function createAppointment(
  page: Page,
  options: {
    start: string;
    duration?: string;
    notes?: string;
    agreedPrice?: string;
    deposit?: string;
    initialPayment?: string;
    expectOverlap?: boolean;
  },
) {
  await page.goto("/new-appointment");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await page.locator("#appointment-start").fill(options.start);
  await page.locator("#appointment-duration").fill(options.duration ?? "120");
  await page.locator("input[name='designIds']").first().check();
  await page.locator("input[name='finalDesignId']").first().check();
  await page.locator("#appointment-notes").fill(options.notes ?? "Final QA appointment notes");
  await page.locator("#agreed-price").fill(options.agreedPrice ?? "350.00");
  await page.locator("#deposit-required").fill(options.deposit ?? "100.00");
  await page.locator("#initial-payment").fill(options.initialPayment ?? "0.00");
  await page.locator(".appointment-form button[type='submit']").click();

  if (options.expectOverlap) {
    await expect(page.locator(".overlap-warning")).toBeVisible();
    await expect(page).toHaveURL(/\/new-appointment$/);
    return null;
  }

  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function moneyValue(page: Page, label: string) {
  const item = page.locator(".money-summary-grid > div").filter({
    has: page.locator("dt", { hasText: label }),
  });
  await expect(item).toHaveCount(1);
  return (await item.locator("dd").innerText()).trim();
}

async function expectPrivateRoute404(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} must be unavailable to another artist`).toBe(404);
}

async function verifyOwnershipIsolation(browser: Browser, paths: {
  clientPath: string;
  designPath: string;
  appointmentPath: string;
}, unique: string) {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await signUp(page, `second-${unique}@example.com`, "Second QA Artist");

  await expectPrivateRoute404(page, paths.clientPath);
  await expectPrivateRoute404(page, paths.designPath);
  await expectPrivateRoute404(page, paths.appointmentPath);

  const designId = paths.designPath.split("/").at(-1)!;
  const imageResponse = await context.request.get(`/api/designs/${designId}/image`);
  expect(imageResponse.status()).toBe(404);

  await context.close();
}

test("Pass 8 workflows A-F, persistence, errors, and ownership boundaries", async ({ page, browser }) => {
  const unique = Date.now().toString(36);
  const email = `final-${unique}@example.com`;

  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, email);

  const clientPath = await createClient(page, unique);
  const designPath = await createDesign(page);

  // Workflow A: create and reopen a connected appointment with a deposit/payment.
  const appointmentPath = await createAppointment(page, {
    start: "2026-10-05T10:00",
    duration: "120",
    notes: "Workflow A connected appointment",
    agreedPrice: "350.00",
    deposit: "100.00",
    initialPayment: "25.00",
  });
  expect(appointmentPath).not.toBeNull();
  await expect(page.getByText("Final QA Client", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Final QA Design", { exact: true }).first()).toBeVisible();
  expect(await moneyValue(page, "Amount received")).toBe("25.00");
  expect(await moneyValue(page, "Deposit remaining")).toBe("75.00");
  expect(await moneyValue(page, "Remaining balance")).toBe("325.00");
  await page.reload();
  await expect(page.getByText("Workflow A connected appointment", { exact: true })).toBeVisible();

  // Workflow B: imported design is searchable and reusable on a later appointment.
  await page.goto("/designs");
  await page.locator(".search-bar input[name='q']").fill("Final QA Design");
  await page.locator(".search-bar button[type='submit']").click();
  await expect(page.locator(".design-card").filter({ hasText: "Final QA Design" })).toBeVisible();
  const laterAppointmentPath = await createAppointment(page, {
    start: "2026-10-06T14:00",
    duration: "90",
    notes: "Workflow B later appointment",
    agreedPrice: "220.00",
    deposit: "80.00",
  });
  expect(laterAppointmentPath).not.toBeNull();
  await expect(page.getByText("Final QA Design", { exact: true }).first()).toBeVisible();

  // Workflow C: create on phone, edit/reschedule, verify desktop sees the same persisted data.
  const phoneAppointmentPath = await createAppointment(page, {
    start: "2026-10-07T09:00",
    duration: "90",
    notes: "Workflow C phone appointment",
    agreedPrice: "300.00",
    deposit: "100.00",
  });
  expect(phoneAppointmentPath).not.toBeNull();
  await page.goto(`${phoneAppointmentPath}/edit`);
  await page.locator("#appointment-start").fill("2026-10-07T13:15");
  await page.locator("#appointment-duration").fill("180");
  await page.locator("#appointment-notes").fill("Workflow C rescheduled on phone");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(new RegExp(`${phoneAppointmentPath}$`));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${phoneAppointmentPath}/edit`);
  await expect(page.locator("#appointment-start")).toHaveValue("2026-10-07T13:15");
  await expect(page.locator("#appointment-duration")).toHaveValue("180");
  await expect(page.locator("#appointment-notes")).toHaveValue("Workflow C rescheduled on phone");

  // Workflow D: partial deposit math plus a visible invalid-payment error state.
  await page.goto(appointmentPath!);
  await page.locator("#payment-amount").fill("10.999");
  await page.locator(".payment-entry-form button[type='submit']").click();
  await expect(page.locator(".payment-entry-form .form-error")).toBeVisible();

  await page.locator("#payment-amount").fill("25.00");
  await page.locator(".payment-entry-form button[type='submit']").click();
  await expect(page.locator(".form-success")).toHaveText("Payment recorded.");
  expect(await moneyValue(page, "Amount received")).toBe("50.00");
  expect(await moneyValue(page, "Deposit remaining")).toBe("50.00");
  expect(await moneyValue(page, "Remaining balance")).toBe("300.00");
  await expect(page.getByText("Partially paid", { exact: true }).first()).toBeVisible();

  // Workflow E: overlap is blocked until explicitly acknowledged.
  await page.setViewportSize({ width: 390, height: 844 });
  await createAppointment(page, {
    start: "2026-10-05T11:00",
    duration: "60",
    notes: "Workflow E overlap candidate",
    agreedPrice: "150.00",
    deposit: "50.00",
    expectOverlap: true,
  });
  await page.locator("#allow-overlap-confirmation").check();
  await expect(page.locator("input[name='allowOverlap']")).toHaveValue("true");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/, { timeout: 15_000 });

  // Workflow F: language preference persists through reload and a new login session.
  await page.goto("/calendar");
  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".app-topbar .language-select")).toHaveValue("es");
  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();

  await page.locator(".app-topbar .signout-button").click();
  await page.waitForURL(/\/sign-in$/);
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();
  await page.locator(".app-topbar .language-select").selectOption("en");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".app-topbar .language-select")).toHaveValue("en");

  // Implementation-quality requirement: saved data survives login and artist ownership is enforced.
  await page.goto(appointmentPath!);
  await expect(page.getByText("Workflow A connected appointment", { exact: true })).toBeVisible();
  await expect(page.getByText("Final QA Design", { exact: true }).first()).toBeVisible();

  await verifyOwnershipIsolation(
    browser,
    { clientPath, designPath, appointmentPath: appointmentPath! },
    unique,
  );
});
