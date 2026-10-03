import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { fillAppointmentStart, revealAppointmentMoney } from "./appointment-helpers";
import { appointmentReturnWithSelection, validateAppointmentReturn } from "../src/lib/appointment-return";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const draftNotes = "Keep the original linework reference.\nPrivate tattoo placement notes — € and 🖋️.";

async function prepareStudio(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Appointment draft artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Draft-Workflow-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(/\/calendar/);

  await page.goto("/clients/new");
  await page.locator("#client-name").fill("Original draft client");
  await page.locator("#client-phone").fill("+34611000401");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(/\/clients\/(?!new$)[A-Za-z0-9_-]+$/);
  const clientId = new URL(page.url()).pathname.split("/").at(-1)!;
  const upload = await page.request.post("/api/designs", {
    multipart: { title: "Original final artwork", image: { name: "original.png", mimeType: "image/png", buffer: png } },
  });
  expect(upload.status()).toBe(201);
  const { id: designId } = await upload.json() as { id: string };
  return { clientId, designId };
}

async function fillDraft(page: Page, clientId: string, designId: string) {
  await page.locator("#appointment-client").selectOption(clientId);
  await fillAppointmentStart(page, "2026-10-09T14:15");
  await page.locator("#appointment-status").selectOption("CONFIRMED");
  await page.locator(`input[name='designIds'][value='${designId}']`).check();
  await page.locator(`input[name='finalDesignId'][value='${designId}']`).check();
  await page.locator("#appointment-notes").fill(draftNotes);
  await revealAppointmentMoney(page);
  await page.locator("#agreed-price").fill("385.50");
  await page.locator("#deposit-required").fill("100.00");
  if (await page.locator("#initial-payment").count()) await page.locator("#initial-payment").fill("25.25");
}

async function expectDraft(page: Page, clientId: string, designId: string, initialPayment = true) {
  await expect(page.locator("#appointment-client")).toHaveValue(clientId);
  await expect(page.locator("#appointment-date")).toHaveValue("2026-10-09");
  await expect(page.locator("#appointment-time")).toHaveValue("14:15");
  await expect(page.locator("input[name='startsAtLocal']")).toHaveValue("2026-10-09T14:15");
  await expect(page.locator("#appointment-status")).toHaveValue("CONFIRMED");
  await expect(page.locator(`input[name='designIds'][value='${designId}']`)).toBeChecked();
  await expect(page.locator(`input[name='finalDesignId'][value='${designId}']`)).toBeChecked();
  await expect(page.locator("#appointment-notes")).toHaveValue(draftNotes);
  await revealAppointmentMoney(page);
  await expect(page.locator("#agreed-price")).toHaveValue("385.50");
  await expect(page.locator("#deposit-required")).toHaveValue("100.00");
  if (initialPayment) await expect(page.locator("#initial-payment")).toHaveValue("25.25");
}

async function leaveBooking(page: Page, kind: "client" | "design", expectedPath: string) {
  await page.locator(`.appointment-form a[href^='/${kind === "client" ? "clients" : "designs"}/new']`).click();
  await page.waitForURL(url => url.pathname === `/${kind === "client" ? "clients" : "designs"}/new`);
  const returnTo = new URL(page.url()).searchParams.get("returnTo");
  expect(validateAppointmentReturn(returnTo)).toBe(returnTo);
  expect(new URL(returnTo!, "http://127.0.0.1:3000").pathname).toBe(expectedPath);
  expect(page.url()).not.toContain("Private");
  expect(page.url()).not.toContain("385.50");
  return returnTo!;
}

test("new booking survives adding a client and importing artwork with every entered value intact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { clientId, designId } = await prepareStudio(page);
  await page.goto("/new-appointment?date=2026-10-09");
  await fillDraft(page, clientId, designId);

  await leaveBooking(page, "client", "/new-appointment");
  await expect(page.getByRole("link", { name: /Back to appointment/ })).toBeVisible();
  await page.locator("#client-name").fill("Newly added booking client");
  await page.locator("#client-phone").fill("+34611000402");
  await page.locator(".client-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/new-appointment");
  await expect(page.locator("#appointment-client option:checked")).toContainText("Newly added booking client");
  const newClientId = await page.locator("#appointment-client").inputValue();
  expect(newClientId).not.toBe(clientId);
  await expectDraft(page, newClientId, designId);

  await leaveBooking(page, "design", "/new-appointment");
  await page.locator("#design-image").setInputFiles({ name: "new-reference.png", mimeType: "image/png", buffer: png });
  await page.locator("#design-title").fill("Newly imported tattoo reference");
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/designs");
  await page.locator(".design-form button[type='submit']").click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const { id: importedId } = await response.json() as { id: string };
  await page.waitForURL(url => url.pathname === "/new-appointment");
  await expectDraft(page, newClientId, designId);
  await expect(page.locator(`input[name='designIds'][value='${importedId}']`)).toBeChecked();
  await expect(page.locator("input[name='designIds']:checked")).toHaveCount(2);

  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  await expect(page.locator(".appointment-notes")).toHaveText(draftNotes);
  await expect(page.locator(".appointment-design-gallery")).toContainText("Newly imported tattoo reference");
  await expect(page.locator(".appointment-design-gallery")).toContainText("Original final artwork");
  expect(errors).toEqual([]);
});

test("cancel and browser back return to new and edited appointment drafts without clearing fields", async ({ page }) => {
  const { clientId, designId } = await prepareStudio(page);
  await page.goto("/new-appointment");
  await fillDraft(page, clientId, designId);
  await leaveBooking(page, "client", "/new-appointment");
  await page.locator("#client-name").fill("Unsaved client");
  await page.locator(".client-form").getByRole("link", { name: "Cancel", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/new-appointment");
  await expectDraft(page, clientId, designId);
  await expect(page.locator("#appointment-client")).not.toContainText("Unsaved client");

  await leaveBooking(page, "design", "/new-appointment");
  await page.getByRole("link", { name: "Back to appointment", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/new-appointment");
  await expectDraft(page, clientId, designId);
  // Save a different baseline so the edit-return assertions prove unsaved changes survived.
  await fillAppointmentStart(page, "2026-10-09T09:00");
  await page.locator("#appointment-status").selectOption("PLANNED");
  await page.locator("#appointment-notes").fill("Stored appointment before editing");
  await page.locator("#agreed-price").fill("420.00");
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(/\/appointments\/[A-Za-z0-9_-]+$/);
  const appointmentPath = new URL(page.url()).pathname;

  await page.goto(`${appointmentPath}/edit`);
  await fillDraft(page, clientId, designId);
  await leaveBooking(page, "client", `${appointmentPath}/edit`);
  await page.goBack();
  await page.waitForURL(url => url.pathname === `${appointmentPath}/edit`);
  await expectDraft(page, clientId, designId, false);

  await leaveBooking(page, "design", `${appointmentPath}/edit`);
  await page.locator(".design-form").getByRole("link", { name: "Cancel", exact: true }).click();
  await page.waitForURL(url => url.pathname === `${appointmentPath}/edit`);
  await expectDraft(page, clientId, designId, false);
  await page.locator(".appointment-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === appointmentPath);
  await expect(page.locator(".appointment-notes")).toHaveText(draftNotes);
});

test("appointment return destinations accept only bounded internal draft routes", async () => {
  const draft = "2ffb7c52-f695-4d14-98c1-9022acf0b05c";
  const destination = `/new-appointment?date=2026-10-09&draft=${draft}`;
  expect(validateAppointmentReturn(destination)).toBe(destination);
  expect(validateAppointmentReturn(`/appointments/known-record/edit?draft=${draft}`)).toBe(`/appointments/known-record/edit?draft=${draft}`);
  expect(appointmentReturnWithSelection(destination, "createdClient", "new-record")).toBe(`${destination}&createdClient=new-record`);
  for (const invalid of [
    `https://example.com/new-appointment?draft=${draft}`,
    `//example.com/new-appointment?draft=${draft}`,
    `/new-appointment?draft=${draft}&draft=${draft}`,
    `/new-appointment?date=2026-02-29&draft=${draft}`,
    `/new-appointment?draft=${draft}&notes=private`,
    `/new-appointment?draft=${draft}#fragment`,
    `/appointments/../new-appointment?draft=${draft}`,
    `/appointments/known-record/edit?date=2026-10-09&draft=${draft}`,
    "/new-appointment?draft=invalid",
    [destination],
  ]) expect(validateAppointmentReturn(invalid)).toBeNull();
});
