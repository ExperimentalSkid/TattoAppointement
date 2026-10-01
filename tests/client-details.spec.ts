import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { Pool } from "pg";

test.use({ timezoneId: "America/New_York" });

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const notes = "Placement: left forearm.\nKeep the existing line-work reference for the next tattoo.";

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Client-detail fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function signUp(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Client details QA artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Client-Details-QA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function uploadArtwork(page: Page, title: string) {
  const response = await page.request.post("/api/designs", {
    multipart: { title, image: { name: "client-details.png", mimeType: "image/png", buffer: png } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

async function seedClientDetails(page: Page) {
  const finalId = await uploadArtwork(page, "Client detail final artwork");
  const referenceId = await uploadArtwork(page, "Client detail newer reference");
  const base = Date.now();
  const date = (days: number) => new Date(base + days * 86_400_000).toISOString();
  const appointments = [
    { id: "detail-next", startsAt: date(3), status: "CONFIRMED" },
    { id: "detail-later", startsAt: date(5), status: "PLANNED" },
    { id: "detail-future-completed", startsAt: date(4), status: "COMPLETED" },
    { id: "detail-no-show", startsAt: date(2), status: "NO_SHOW" },
    { id: "detail-cancelled", startsAt: date(1), status: "CANCELLED" },
    { id: "detail-past-planned", startsAt: date(-1), status: "PLANNED" },
    { id: "detail-past-confirmed", startsAt: date(-2), status: "CONFIRMED" },
    { id: "detail-completed", startsAt: date(-3), status: "COMPLETED" },
  ];
  await withTestDatabase(async pool => {
    const owner = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    expect(owner.rows).toHaveLength(1);
    const artistId = owner.rows[0].id;
    await pool.query(
      'INSERT INTO "Client" (id,"artistId",name,phone,email,notes,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now()),($8,$2,$9,$10,null,null,$7,now())',
      ["detail-client", artistId, "Aster Detailed Client", "+34611000801", "client.with.a.long.address.for.mobile@example.test", notes, "2024-01-03T12:00:00.000Z", "detail-empty", "Elena Empty Client", "+34611000803"],
    );
    await pool.query(
      'INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") SELECT x.id,$1,$2,x."startsAt"::timestamp,120,x.status::"AppointmentStatus",now() FROM jsonb_to_recordset($3::jsonb) AS x(id text,"startsAt" text,status text)',
      [artistId, "detail-client", JSON.stringify(appointments)],
    );
    await pool.query(
      'INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") VALUES ($1,$2,true),($1,$3,false),($4,$3,false),($5,$3,false)',
      ["detail-next", finalId, referenceId, "detail-completed", "detail-cancelled"],
    );
  });
  return { finalId, referenceId, appointments };
}

function appointmentRow(page: Page, id: string) {
  return page.locator(`main a[href='/appointments/${id}']`);
}

async function expectArtwork(row: Locator, id: string, title: string) {
  const image = row.locator("img");
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute("src", `/api/designs/${id}/image?variant=preview`);
  await expect(image).toHaveAttribute("alt", title);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

test("client detail separates upcoming bookings from complete history and keeps real artwork, contact and notes", async ({ page, browser }) => {
  await signUp(page);
  const fixture = await seedClientDetails(page);
  await page.goto("/clients/detail-client");
  await expect(page.locator(".page-heading")).toHaveText("Aster Detailed Client");
  await expect(page.getByRole("link", { name: /^Call/ })).toHaveAttribute("href", "tel:+34611000801");
  await expect(page.getByRole("link", { name: /^Email/ })).toHaveAttribute("href", "mailto:client.with.a.long.address.for.mobile@example.test");
  await expect(page.getByRole("heading", { name: "Upcoming", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText(notes);
  await expect(page.locator("main")).toContainText("8 appointments");
  await expect(page.getByRole("region", { name: "Upcoming", exact: true }).locator(".appointment-history-item")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "History", exact: true }).locator(".appointment-history-item")).toHaveCount(6);
  await expect(page.locator(".client-added time")).toHaveAttribute("datetime", "2024-01-03T12:00:00.000Z");
  await expect(page.locator(".client-added time")).toHaveText("3 Jan 2024");
  const links = page.locator("main a[href^='/appointments/']");
  await expect(links).toHaveCount(fixture.appointments.length);
  expect(await links.evaluateAll(elements => elements.map(element => element.getAttribute("href")))).toEqual(fixture.appointments.map(appointment => `/appointments/${appointment.id}`));
  for (const appointment of fixture.appointments) {
    const row = appointmentRow(page, appointment.id);
    await expect(row).toHaveCount(1);
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", appointment.status);
    await expect(row.locator("time")).toHaveAttribute("datetime", appointment.startsAt);
    const formatted = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(appointment.startsAt));
    await expect(row.locator("time")).toHaveText(formatted);
  }
  await expectArtwork(appointmentRow(page, "detail-next"), fixture.finalId, "Client detail final artwork");
  await expect(appointmentRow(page, "detail-next")).toContainText("Final design");
  await expect(appointmentRow(page, "detail-next")).not.toContainText("Client detail newer reference");
  await expectArtwork(appointmentRow(page, "detail-completed"), fixture.referenceId, "Client detail newer reference");
  await expect(appointmentRow(page, "detail-completed")).toContainText("Reference");
  await expectArtwork(appointmentRow(page, "detail-cancelled"), fixture.referenceId, "Client detail newer reference");
  for (const id of ["detail-later", "detail-future-completed", "detail-no-show", "detail-past-planned", "detail-past-confirmed"]) {
    await expect(appointmentRow(page, id).locator("img")).toHaveCount(0);
    await expect(appointmentRow(page, id).locator(".client-artwork-preview")).toHaveCount(0);
  }
  const visitor = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    expect((await visitor.request.get(`/api/designs/${fixture.finalId}/image?variant=preview`)).status()).toBe(401);
    const anonymousPage = await visitor.newPage();
    await anonymousPage.goto("/clients/detail-client");
    await expect(anonymousPage).toHaveURL(/\/sign-in/);
  } finally { await visitor.close(); }
  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(page.getByRole("heading", { name: "Próximas citas", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historial", exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText("8 citas");
  await expect(appointmentRow(page, "detail-next")).toContainText("Diseño final");
  await expect(appointmentRow(page, "detail-cancelled").locator("[data-status]")).toHaveText("Cancelada");
  const upcoming = fixture.appointments[0];
  await expect(appointmentRow(page, upcoming.id).locator("time")).toHaveText(new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(upcoming.startsAt)));
});

test("client detail remains usable on mobile with edit, back, full-row navigation and clear empty states", async ({ page }, testInfo) => {
  await signUp(page);
  await seedClientDetails(page);
  await page.goto("/clients/detail-client");
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("link", { name: /^Call/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Email/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const screenshot = testInfo.outputPath(`client-detail-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`client-detail-${viewport.width}`, { path: screenshot, contentType: "image/png" });
  }
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/clients/detail-client/edit");
  await expect(page.locator("#client-notes")).toHaveValue(notes);
  await page.locator(".client-form a[href='/clients/detail-client']").click();
  await page.waitForURL(url => url.pathname === "/clients/detail-client");
  const next = appointmentRow(page, "detail-next");
  await next.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(next).toBeFocused();
  expect(await next.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
  await page.keyboard.press("Enter");
  await page.waitForURL(url => url.pathname === "/appointments/detail-next");
  await page.goto("/clients/detail-client");
  await appointmentRow(page, "detail-cancelled").locator("[data-status]").click();
  await page.waitForURL(url => url.pathname === "/appointments/detail-cancelled");
  await page.goto("/clients/detail-client");
  await page.locator("main a[href='/clients']").click();
  await page.waitForURL(url => url.pathname === "/clients");
  await page.locator(".client-list-item[href='/clients/detail-empty']").click();
  await page.waitForURL(url => url.pathname === "/clients/detail-empty");
  await expect(page.locator(".page-heading")).toHaveText("Elena Empty Client");
  await expect(page.getByRole("link", { name: /^Email/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Call/ })).toHaveAttribute("href", "tel:+34611000803");
  await expect(page.locator("main a[href^='/appointments/']")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("0 appointments");
  await expect(page.locator("main")).toContainText("No appointments for this client yet.");
  await expect(page.locator("main")).toContainText("No notes yet.");
  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(page.locator("main")).toContainText("0 citas");
  await expect(page.locator("main")).toContainText("Este cliente todavía no tiene citas.");
  await expect(page.locator("main")).toContainText("Todavía no hay notas.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
