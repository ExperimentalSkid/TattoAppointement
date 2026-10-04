import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fillAppointmentStart, revealAppointmentMoney } from "./appointment-helpers";

const origin = "http://127.0.0.1:3000";
const password = "Page-Recovery-2026!";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function artist(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-up");
  const language = page.locator(".auth-language .language-select");
  if (await language.inputValue() !== "en") await Promise.all([page.waitForEvent("load"), language.selectOption("en")]);
  await page.locator("#name").fill("Page recovery artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill(password);
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function exported(page: Page) {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  return response.json();
}

async function spanish(page: Page) {
  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
}

async function client(page: Page) {
  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Recovery tattoo client");
  await page.locator("#client-phone").fill("+34611009920");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function booking(page: Page) {
  await client(page);
  await page.goto("/new-appointment?date=2027-11-05");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await fillAppointmentStart(page, "2027-11-05T10:00");
  await page.locator("#appointment-notes").fill("Original saved tattoo notes");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  return new URL(page.url()).pathname;
}

async function fill(page: Page, values: Record<string, string>) {
  for (const [field, value] of Object.entries(values)) await page.locator(field).fill(value);
}

async function interrupt(page: Page, info: TestInfo, path: string, selector: string, values: Record<string, string>, message: string) {
  let requests = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route(url => url.origin === origin && url.pathname === path, async route => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      requests += 1;
      if (requests === 1) { await route.abort("failed"); return; }
    }
    await route.continue();
  });
  const form = page.locator(selector);
  await form.locator("button[type='submit']").click();
  await expect.poll(async () => await form.locator("[role='alert']").count() > 0 || await page.locator(".route-message").isVisible(), { timeout: 3_500 }).toBe(true).catch(() => {});
  const mounted = await form.count() === 1;
  const draft: Record<string, string | null> = {};
  for (const field of Object.keys(values)) {
    draft[field] = await page.locator(field).count() ? await page.locator(field).inputValue() : null;
  }
  const safeDraft = Object.fromEntries(Object.entries(draft).map(([field, value]) => [field, field.includes("password") ? { retained: value === values[field], length: value?.length ?? 0 } : value]));
  const screenshot = info.outputPath("dropped-page-save.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("Dropped save and retained draft", { path: screenshot, contentType: "image/png" });
  await info.attach("Dropped save diagnostic", { body: JSON.stringify({ requests, formMounted: mounted, draft: safeDraft, pageErrors,
    inlineFeedback: mounted ? await form.locator("[role='alert']").allTextContents() : [],
    routeError: await page.locator(".route-message").allTextContents() }, null, 2), contentType: "application/json" });
  expect(requests).toBe(1);
  await expect(form).toBeVisible({ timeout: 3_000 });
  await expect(form.getByRole("alert").filter({ hasText: message }).first()).toBeVisible({ timeout: 3_000 });
  expect(draft).toEqual(values);
  await expect(form.locator("button[type='submit']")).toBeEnabled({ timeout: 3_000 });
  expect(pageErrors).toEqual([]);
  return { form, requests: () => requests, pageErrors };
}

test("a dropped password change keeps the entered values, shows Spanish feedback and retries once", async ({ page, browser }, info) => {
  await artist(page);
  await page.goto("/settings");
  await spanish(page);
  const changedPassword = "Recovered-Password-2026!";
  const values = { "#current-password": password, "#new-password": changedPassword, "#confirm-password": changedPassword };
  await fill(page, values);
  const result = await interrupt(page, info, "/settings", ".password-settings-form", values, "No se ha cambiado la contraseña. Inténtalo de nuevo.");
  const other = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.92.0.2" } });
  try {
    const oldLogin = await other.request.post("/api/auth/sign-in/email", { headers: { origin }, data: { email: "owner@example.com", password } });
    expect(oldLogin.status()).toBe(200);
    await result.form.locator("button[type='submit']").click();
    await expect(result.form.locator(".settings-success")).toBeVisible();
    for (const field of Object.keys(values)) await expect(page.locator(field)).toHaveValue("");
    expect(result.requests()).toBe(2);
    await page.locator(".signout-button:visible").click();
    await page.waitForURL(url => url.pathname === "/sign-in");
    if (!(await page.locator("#email").isVisible())) await page.locator(".auth-email-option > summary").click();
    await page.locator("#email").fill("owner@example.com");
    await page.locator("#password").fill(changedPassword);
    await page.locator(".auth-form button[type='submit']").click();
    await page.waitForURL(url => url.pathname === "/calendar");
    expect(result.pageErrors).toEqual([]);
  } finally { await other.close(); }
});

test("a dropped artwork metadata edit retains its original version and retries the exact Spanish draft", async ({ page }, info) => {
  await artist(page);
  await page.goto("/designs/new");
  await page.locator("#design-image").setInputFiles({ name: "page-recovery.png", mimeType: "image/png", buffer: png });
  await page.locator("#design-title").fill("Original tattoo artwork");
  await page.locator(".design-form button[type='submit']").click();
  await page.waitForURL(/\/designs\/(?!new$)[A-Za-z0-9_-]+$/);
  const path = new URL(page.url()).pathname;
  const before = (await exported(page)).designs;
  await page.goto(`${path}/edit`);
  await spanish(page);
  const baseline = await page.locator("input[name='expectedVersion']").inputValue();
  const values = { "#design-title": "Líneas recuperadas", "#design-notes": "Primera línea.\nSegunda línea del boceto." };
  await fill(page, values);
  const result = await interrupt(page, info, `${path}/edit`, "form.design-form", values, "No se pudo guardar el diseño.");
  await expect(page.locator("input[name='expectedVersion']")).toHaveValue(baseline);
  expect((await exported(page)).designs).toEqual(before);
  await result.form.locator("button[type='submit']").click();
  await page.waitForURL(url => url.pathname === path);
  const saved = (await exported(page)).designs;
  expect(saved).toHaveLength(1);
  expect(saved[0].title).toBe(values["#design-title"]);
  expect(saved[0].notes.replace(/\r\n/g, "\n")).toBe(values["#design-notes"]);
  expect(result.requests()).toBe(2);
  expect(result.pageErrors).toEqual([]);
});

test("a dropped new booking keeps all entered fields and creates its payment only on the successful retry", async ({ page }, info) => {
  await artist(page);
  await client(page);
  await page.goto("/new-appointment?date=2027-11-05");
  await page.locator("#appointment-client").selectOption({ index: 1 });
  await revealAppointmentMoney(page);
  const values = { "#appointment-date": "2027-11-05", "#appointment-time": "10:00", "#appointment-notes": "Draft tattoo placement\nKeep both lines.", "#agreed-price": "250.00", "#deposit-required": "50.00", "#initial-payment": "23.75" };
  await fill(page, values);
  await page.locator("#appointment-status").selectOption("CONFIRMED");
  const selectedClient = await page.locator("#appointment-client").inputValue();
  const result = await interrupt(page, info, "/new-appointment", ".appointment-form", values, "Could not save the appointment.");
  await expect(page.locator("#appointment-client")).toHaveValue(selectedClient);
  await expect(page.locator("#appointment-status")).toHaveValue("CONFIRMED");
  const unchanged = await exported(page);
  expect(unchanged.appointments).toEqual([]);
  expect(unchanged.payments).toEqual([]);
  await result.form.locator("button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const saved = await exported(page);
  expect(saved.appointments).toHaveLength(1);
  expect(saved.appointments[0]).toMatchObject({ clientId: selectedClient, startsAt: "2027-11-05T09:00:00.000Z", status: "CONFIRMED", agreedPrice: "250", depositRequired: "50" });
  expect(saved.appointments[0].notes.replace(/\r\n/g, "\n")).toBe(values["#appointment-notes"]);
  expect(saved.payments).toEqual([expect.objectContaining({ appointmentId: saved.appointments[0].id, amount: "23.75" })]);
  expect(result.requests()).toBe(2);
  expect(result.pageErrors).toEqual([]);
});

test("a dropped booking edit preserves its draft and stale-write baseline before one successful retry", async ({ page }, info) => {
  await artist(page);
  const path = await booking(page);
  const before = (await exported(page)).appointments;
  await page.goto(`${path}/edit`);
  await spanish(page);
  await revealAppointmentMoney(page);
  const baseline = await page.locator("input[name='expectedVersion']").inputValue();
  const values = { "#appointment-date": "2027-11-06", "#appointment-time": "15:30", "#appointment-notes": "Colocación nueva\nNotas recuperadas.", "#agreed-price": "275,50", "#deposit-required": "50,00" };
  await fill(page, values);
  await page.locator("#appointment-status").selectOption("CONFIRMED");
  const result = await interrupt(page, info, `${path}/edit`, ".appointment-form", values, "No se pudo guardar la cita.");
  await expect(page.locator("input[name='expectedVersion']")).toHaveValue(baseline);
  expect((await exported(page)).appointments).toEqual(before);
  await result.form.locator("button[type='submit']").click();
  await page.waitForURL(url => url.pathname === path);
  const saved = (await exported(page)).appointments;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: before[0].id, startsAt: "2027-11-06T14:30:00.000Z", status: "CONFIRMED", agreedPrice: "275.5", depositRequired: "50" });
  expect(saved[0].notes.replace(/\r\n/g, "\n")).toBe(values["#appointment-notes"]);
  expect(result.requests()).toBe(2);
  expect(result.pageErrors).toEqual([]);
});

test("a dropped reschedule retains the chosen Madrid date and time and retries once", async ({ page }, info) => {
  await artist(page);
  const path = await booking(page);
  const before = (await exported(page)).appointments;
  await spanish(page);
  await page.getByRole("button", { name: "Reprogramar", exact: true }).click();
  const baseline = await page.locator(".appointment-reschedule-form input[name='expectedVersion']").inputValue();
  const values = { "#reschedule-date": "2027-11-08", "#reschedule-time": "11:45" };
  await fill(page, values);
  const result = await interrupt(page, info, path, ".appointment-reschedule-form", values, "No se pudo guardar la cita.");
  await expect(page.locator(".appointment-reschedule-form input[name='expectedVersion']")).toHaveValue(baseline);
  expect((await exported(page)).appointments).toEqual(before);
  await result.form.locator("button[type='submit']").click();
  await expect(page.locator(".appointment-record-meta > time")).toHaveAttribute("datetime", "2027-11-08T10:45:00.000Z");
  const saved = (await exported(page)).appointments;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: before[0].id, startsAt: "2027-11-08T10:45:00.000Z", notes: before[0].notes, status: before[0].status });
  expect(result.requests()).toBe(2);
  expect(result.pageErrors).toEqual([]);
});

test("a dropped existing client edit preserves all contact fields and its original version", async ({ page }, info) => {
  await artist(page);
  const path = await client(page);
  const before = (await exported(page)).clients;
  await page.goto(`${path}/edit`);
  await spanish(page);
  const baseline = await page.locator("input[name='expectedVersion']").inputValue();
  const values = { "#client-name": "Lucía recuperada", "#client-phone": "+34 611 009 921", "#client-email": "lucia@example.test", "#client-notes": "Referencia inicial.\nSegunda línea conservada." };
  await fill(page, values);
  const result = await interrupt(page, info, `${path}/edit`, ".client-form", values, "No se pudo guardar el cliente.");
  await expect(page.locator("input[name='expectedVersion']")).toHaveValue(baseline);
  expect((await exported(page)).clients).toEqual(before);
  await result.form.locator("button[type='submit']").click();
  await page.waitForURL(url => url.pathname === path);
  expect((await exported(page)).clients).toEqual([expect.objectContaining({ id: before[0].id, name: values["#client-name"], phone: "+34611009921", email: values["#client-email"], notes: values["#client-notes"] })]);
  expect(result.requests()).toBe(2);
  expect(result.pageErrors).toEqual([]);
});
