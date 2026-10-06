import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { Pool } from "pg";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Client-list fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function signUp(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Client list QA artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Client-List-QA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function uploadArtwork(page: Page, title: string) {
  const response = await page.request.post("/api/designs", {
    multipart: { title, image: { name: "client-list.png", mimeType: "image/png", buffer: png } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

async function seedDirectory(page: Page) {
  const finalId = await uploadArtwork(page, "Aster final tattoo");
  const referenceId = await uploadArtwork(page, "Aster newer reference");
  const fallbackId = await uploadArtwork(page, "Bruna archived reference");
  // Relative UTC dates keep the next-booking assertions valid after the fixture's creation day.
  const base = Date.now();
  const date = (days: number) => new Date(base + days * 86_400_000).toISOString();
  const nextAster = date(3);
  const lastBruna = date(-10);
  const nextCleo = date(5);
  const clients = [
    { id: "list-aster", name: "Aster Vega", phone: "+34611000701", email: "aster.vega@example.test" },
    { id: "list-bruna", name: "Bruna Costa", phone: "+34611000703", email: "fallback.costa.with.a.long.address@example.test" },
    { id: "list-cleo", name: "Cleo Mar", phone: "+34611000705", email: "cleo.mar@example.test" },
    { id: "list-dario", name: "Dario Sol", phone: "+34611000707", email: null },
    { id: "list-elena", name: "Elena Rios", phone: "+34611000709", email: null },
  ];
  const appointments = [
    { id: "aster-cancelled", clientId: "list-aster", startsAt: date(1), status: "CANCELLED" },
    { id: "aster-no-show", clientId: "list-aster", startsAt: date(2), status: "NO_SHOW" },
    { id: "aster-next", clientId: "list-aster", startsAt: nextAster, status: "CONFIRMED" },
    { id: "aster-later", clientId: "list-aster", startsAt: date(4), status: "PLANNED" },
    { id: "aster-completed", clientId: "list-aster", startsAt: date(-10), status: "COMPLETED" },
    { id: "aster-past-planned", clientId: "list-aster", startsAt: date(-1), status: "PLANNED" },
    { id: "aster-old-cancelled", clientId: "list-aster", startsAt: date(-5), status: "CANCELLED" },
    { id: "bruna-completed", clientId: "list-bruna", startsAt: lastBruna, status: "COMPLETED" },
    { id: "bruna-old-completed", clientId: "list-bruna", startsAt: date(-30), status: "COMPLETED" },
    { id: "bruna-newer-past-planned", clientId: "list-bruna", startsAt: date(-2), status: "PLANNED" },
    { id: "cleo-next", clientId: "list-cleo", startsAt: nextCleo, status: "PLANNED" },
    { id: "dario-cancelled", clientId: "list-dario", startsAt: date(-3), status: "CANCELLED" },
    { id: "dario-no-show", clientId: "list-dario", startsAt: date(-1), status: "NO_SHOW" },
  ];
  await withTestDatabase(async pool => {
    const owner = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    expect(owner.rows).toHaveLength(1);
    const artistId = owner.rows[0].id;
    await pool.query(
      'INSERT INTO "Client" (id,"artistId",name,phone,email,"updatedAt") SELECT x.id,$1,x.name,x.phone,x.email,now() FROM jsonb_to_recordset($2::jsonb) AS x(id text,name text,phone text,email text)',
      [artistId, JSON.stringify(clients)],
    );
    await pool.query(
      'INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") SELECT x.id,$1,x."clientId",x."startsAt"::timestamp,120,x.status::"AppointmentStatus",now() FROM jsonb_to_recordset($2::jsonb) AS x(id text,"clientId" text,"startsAt" text,status text)',
      [artistId, JSON.stringify(appointments)],
    );
    await pool.query(
      'INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") VALUES ($1,$2,true),($1,$3,false),($4,$5,false)',
      ["aster-next", finalId, referenceId, "bruna-old-completed", fallbackId],
    );
  });
  return { finalId, fallbackId, nextAster, lastBruna, nextCleo };
}

function clientRow(page: Page, id: string) {
  return page.locator(`.client-list-item[href='/clients/${id}']`);
}

async function expectRealArtwork(row: Locator, id: string, title: string) {
  const image = row.locator(".client-artwork-preview img");
  await expect(image).toHaveAttribute("src", `/api/designs/${id}/image?variant=preview`);
  await expect(image).toHaveAttribute("alt", title);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect(row.locator(".client-monogram")).toHaveCount(0);
}

test("client rows show private artwork, the next active booking or completed history, and labelled totals", async ({ page, browser }) => {
  await signUp(page);
  const fixture = await seedDirectory(page);
  await page.goto("/clients");
  await expect(page.locator(".client-list-item")).toHaveCount(5);
  const aster = clientRow(page, "list-aster");
  await expect(aster.locator(".client-booking-context")).toContainText("Next appointment");
  await expect(aster.locator("time")).toHaveAttribute("datetime", fixture.nextAster);
  await expect(aster.locator(".client-count")).toHaveText("7 appointments");
  await expectRealArtwork(aster, fixture.finalId, "Aster final tattoo");
  await expect(aster.locator(".client-artwork-caption")).toContainText("Final design");
  await expect(aster.locator(".client-artwork-caption")).not.toContainText("Aster newer reference");

  const bruna = clientRow(page, "list-bruna");
  await expect(bruna.locator(".client-booking-context")).toContainText("Last completed");
  await expect(bruna.locator("time")).toHaveAttribute("datetime", fixture.lastBruna);
  await expect(bruna.locator(".client-count")).toHaveText("3 appointments");
  await expectRealArtwork(bruna, fixture.fallbackId, "Bruna archived reference");
  await expect(bruna.locator(".client-artwork-caption")).toContainText("Reference");

  const cleo = clientRow(page, "list-cleo");
  await expect(cleo.locator(".client-booking-context")).toContainText("Next appointment");
  await expect(cleo.locator("time")).toHaveAttribute("datetime", fixture.nextCleo);
  await expect(cleo.locator(".client-count")).toHaveText("1 appointment");
  await expect(cleo.locator(".client-monogram")).toHaveText("CM");
  await expect(cleo.locator(".client-artwork-preview")).toHaveCount(0);
  const dario = clientRow(page, "list-dario");
  await expect(dario.locator(".client-booking-context")).toContainText("No upcoming appointment");
  await expect(dario.locator(".client-count")).toHaveText("2 appointments");
  await expect(dario.locator("time")).toHaveCount(0);
  const elena = clientRow(page, "list-elena");
  await expect(elena.locator(".client-booking-context")).toContainText("No appointments yet");
  await expect(elena.locator(".client-count")).toHaveText("0 appointments");
  await expect(elena.locator("time")).toHaveCount(0);
  // A real preview is visible to the artist but remains private to an unsigned visitor.
  const visitor = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    expect((await visitor.request.get(`/api/designs/${fixture.finalId}/image?variant=preview`)).status()).toBe(401);
  } finally { await visitor.close(); }

  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(aster.locator(".client-count")).toHaveText("7 citas");
  await expect(cleo.locator(".client-count")).toHaveText("1 cita");
});

test("client directory stays searchable, responsive and keyboard accessible with whole-row navigation", async ({ page }, testInfo) => {
  await signUp(page);
  await seedDirectory(page);
  await page.goto("/clients");
  await expect(page.locator(".client-list-main > strong")).toHaveText(["Aster Vega", "Bruna Costa", "Cleo Mar", "Dario Sol", "Elena Rios"]);
  for (const query of ["bRuNa", "611000703", "fallback.costa"]) {
    await page.locator(".client-search input[name='q']").fill(query);
    await page.locator(".client-search button[type='submit']").click();
    await page.waitForURL(url => url.pathname === "/clients" && url.searchParams.get("q") === query);
    await expect(page.locator(".client-list-item")).toHaveCount(1);
    await expect(clientRow(page, "list-bruna")).toBeVisible();
  }
  await page.locator(".client-search a[href='/clients']").click();
  await page.waitForURL(url => url.pathname === "/clients" && !url.search);
  await expect(page.locator(".client-list-item")).toHaveCount(5);
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(clientRow(page, "list-bruna").locator(".client-list-contact")).toContainText("fallback.costa.with.a.long.address@example.test");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const filename = `client-directory-${viewport.width}.png`;
    const screenshot = testInfo.outputPath(filename);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(filename, { path: screenshot, contentType: "image/png" });
  }
  await page.locator(".client-search button[type='submit']").focus();
  await page.keyboard.press("Tab");
  const first = clientRow(page, "list-aster");
  await expect(first).toBeFocused();
  expect(await first.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
  await page.keyboard.press("Enter");
  await page.waitForURL(url => url.pathname === "/clients/list-aster");
  await expect(page.locator(".page-heading")).toHaveText("Aster Vega");
  await page.goto("/clients");
  // The supporting contact area belongs to the same single row link.
  await clientRow(page, "list-bruna").locator(".client-list-contact").click();
  await page.waitForURL(url => url.pathname === "/clients/list-bruna");
  await expect(page.locator(".page-heading")).toHaveText("Bruna Costa");
});
