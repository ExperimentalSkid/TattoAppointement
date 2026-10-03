import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { Pool } from "pg";

// Studio dates must remain in Madrid even when the artist's browser is elsewhere.
test.use({ timezoneId: "America/New_York" });

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Design-workflow fixtures require the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function signUp(page: Page) {
  await page.goto("/sign-up");
  if (await page.locator(".auth-language .language-select").inputValue() !== "en") {
    await Promise.all([page.waitForEvent("load"), page.locator(".auth-language .language-select").selectOption("en")]);
  }
  await page.locator("#name").fill("Design workflows QA artist");
  await page.locator("#email").fill("owner@example.com");
  await page.locator("#password").fill("Design-Workflows-QA-2026!");
  await page.locator(".auth-form button[type='submit']").click();
  await page.waitForURL(url => url.pathname === "/calendar");
}

async function uploadArtwork(page: Page, title: string, notes = "") {
  const response = await page.request.post("/api/designs", {
    multipart: { title, notes, image: { name: "design-workflows.png", mimeType: "image/png", buffer: png } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

async function expectLoadedImage(image: Locator) {
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

async function expectAssociatedError(page: Page, field: Locator, message: string) {
  const summary = page.locator(".design-form-feedback");
  await expect(summary).toBeFocused();
  await expect(summary).toContainText(message);
  await summary.locator(`a[href='#${await field.getAttribute("id")}']`).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();
  expect(await field.evaluate(element => (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" "))).toContain(message);
}

test("full-screen artwork loads on demand, falls back to a private preview and recovers after failed images", async ({ page, browser }) => {
  await signUp(page);
  const id = await uploadArtwork(page, "Private full-size tattoo artwork");
  let originalRequests = 0;
  let phase: "loading" | "fallback" | "both-fail" | "recovered" = "loading";
  let releaseOriginal!: () => void;
  const originalReady = new Promise<void>(resolve => { releaseOriginal = resolve; });
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === `/api/designs/${id}/image` && url.searchParams.get("variant") === "original") originalRequests += 1;
  });
  await page.route(`**/api/designs/${id}/image*`, async route => {
    const variant = new URL(route.request().url()).searchParams.get("variant");
    if (variant === "original" && phase === "loading") {
      await originalReady;
    } else if ((variant === "original" && (phase === "fallback" || phase === "both-fail")) || (variant === "preview" && phase === "both-fail")) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    await route.continue();
  });
  try {
    await page.goto(`/designs/${id}`);
    const opener = page.getByRole("button", { name: "Open full-screen", exact: true });
    await expectLoadedImage(opener.locator("img"));
    const dialog = page.locator(".design-dialog");
    await expect(dialog.locator("img")).toHaveCount(0);
    expect(originalRequests).toBe(0);

    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("img")).toHaveAttribute("src", `/api/designs/${id}/image?variant=original`);
    await expect(dialog.getByRole("status")).toContainText(/loading/i);
    await expect.poll(() => originalRequests).toBe(1);
    releaseOriginal();
    await expectLoadedImage(dialog.locator("img"));
    await dialog.getByRole("button", { name: "Close full-screen", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await expect(dialog.locator("img")).toHaveCount(0);

    phase = "fallback";
    // The browser may reuse a successfully decoded immutable image in one document.
    // A fresh document ensures this scenario actually receives the mocked original404.
    await page.reload();
    await expectLoadedImage(opener.locator("img"));
    await expect(dialog.locator("img")).toHaveCount(0);
    expect(originalRequests).toBe(1);
    await opener.click();
    await expect(dialog.locator("img")).toHaveAttribute("src", `/api/designs/${id}/image?variant=preview`);
    await expectLoadedImage(dialog.locator("img"));
    await expect(dialog.getByRole("status")).toContainText(/preview/i);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();

    phase = "both-fail";
    // Likewise, discard the previous successful preview before testing its404 path.
    await page.reload();
    await expectLoadedImage(opener.locator("img"));
    await expect(dialog.locator("img")).toHaveCount(0);
    expect(originalRequests).toBe(2);
    await opener.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /retry|try again/i })).toBeVisible();
    phase = "recovered";
    await dialog.getByRole("button", { name: /retry|try again/i }).click();
    await expect(dialog.locator("img")).toHaveAttribute("src", `/api/designs/${id}/image?variant=original`);
    await expectLoadedImage(dialog.locator("img"));
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    expect(originalRequests).toBe(4);
  } finally { releaseOriginal(); }

  for (const variant of ["preview", "original"]) {
    const ownedImage = await page.request.get(`/api/designs/${id}/image?variant=${variant}`);
    expect(ownedImage.status()).toBe(200);
    expect(ownedImage.headers()["cache-control"]).toContain("private");
    expect(ownedImage.headers()["cache-control"]).toContain("no-store");
  }
  const visitor = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    for (const variant of ["preview", "original"]) {
      expect((await visitor.request.get(`/api/designs/${id}/image?variant=${variant}`)).status()).toBe(401);
    }
  } finally { await visitor.close(); }
});

test("design edits retain every entered value after validation and preserve library search through cancel, save and deletion", async ({ page }) => {
  await signUp(page);
  const query = "Ink & line";
  const id = await uploadArtwork(page, `${query}: original`, "Original archive notes");
  const otherId = await uploadArtwork(page, "Unrelated archive design");
  const designPath = `/designs/${id}`;
  await page.goto(`/designs?q=${encodeURIComponent(query)}`);
  await expect(page.locator(".design-card")).toHaveCount(1);
  const card = page.locator(".design-card").first();
  const cardHref = await card.getAttribute("href");
  expect(new URL(cardHref!, page.url()).searchParams.get("libraryQuery")).toBe(query);
  await card.click();
  await page.waitForURL(url => url.pathname === designPath && url.searchParams.get("libraryQuery") === query);
  await expect(page.locator("main")).toContainText("0 appointments");
  await expect(page.locator("main")).toContainText("This design is not attached to an appointment yet.");
  expect(new URL((await page.getByRole("link", { name: /Back to designs/ }).getAttribute("href"))!, page.url()).searchParams.get("q")).toBe(query);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(url => url.pathname === `${designPath}/edit` && url.searchParams.get("libraryQuery") === query);
  await expect(page.locator("form.design-form input[name='libraryQuery']")).toHaveValue(query);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.waitForURL(url => url.pathname === designPath && url.searchParams.get("libraryQuery") === query);
  await page.getByRole("link", { name: /Back to designs/ }).click();
  await page.waitForURL(url => url.pathname === "/designs" && url.searchParams.get("q") === query);
  await expect(page.locator("input[name='q']")).toHaveValue(query);
  await page.locator(".design-card").click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();

  const title = page.locator("#design-title");
  const notes = page.locator("#design-notes");
  await expect(title).toHaveAttribute("maxlength", "160");
  await expect(notes).toHaveAttribute("maxlength", "4000");
  const enteredNotes = "  Keep every line of this edit.\nDo not replace it with the stored notes.  ";
  await title.fill("   ");
  await notes.fill(enteredNotes);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expectAssociatedError(page, title, "Enter a design name.");
  await expect(title).toHaveValue("   ");
  await expect(notes).toHaveValue(enteredNotes);
  await expect(page).toHaveURL(url => url.pathname === `${designPath}/edit` && url.searchParams.get("libraryQuery") === query);

  // Bypass only the disposable browser's input cap to exercise the server's real notes limit.
  await notes.evaluate(element => element.removeAttribute("maxlength"));
  const enteredTitle = `  ${query}: revised  `;
  const oversizedNotes = "N".repeat(4001);
  await title.fill(enteredTitle);
  await notes.fill(oversizedNotes);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expectAssociatedError(page, notes, "The notes are too long.");
  await expect(title).toHaveValue(enteredTitle);
  await expect(notes).toHaveValue(oversizedNotes);

  const validTitle = `${query}: ${"T".repeat(148)}`;
  expect(validTitle.length).toBe(160);
  const validNotes = "N".repeat(4000);
  await title.fill(validTitle);
  await notes.fill(validNotes);

  // A record disappearing in another tab is a real rejected-save path. Hide only this
  // synthetic, unlinked design temporarily; preserve ownership and restore it.
  const unavailableId = `unavailable-${id}`;
  await withTestDatabase(pool => pool.query('UPDATE "Design" SET id=$1 WHERE id=$2', [unavailableId, id]));
  try {
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.locator("[data-sync-conflict]")).toBeFocused();
    await expect(page.locator("[data-sync-conflict]")).toContainText("This record changed on another device. Your unsaved changes are still here.");
    await expect(title).toHaveValue(validTitle);
    await expect(notes).toHaveValue(validNotes);
    await expect(page).toHaveURL(url => url.pathname === `${designPath}/edit` && url.searchParams.get("libraryQuery") === query);
  } finally {
    await withTestDatabase(pool => pool.query('UPDATE "Design" SET id=$1 WHERE id=$2', [id, unavailableId]));
  }
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForURL(url => url.pathname === designPath && url.searchParams.get("libraryQuery") === query);
  await expect(page.locator(".page-heading")).toHaveText(validTitle);
  await expect(page.locator(".detail-notes")).toHaveText(validNotes);

  // Query context is a bounded keyword, never an arbitrary redirect destination.
  const urlLikeQuery = "https://outside.example/artist?next=/settings";
  await page.goto(`${designPath}?libraryQuery=${encodeURIComponent(urlLikeQuery)}`);
  const safeBack = new URL((await page.getByRole("link", { name: /Back to designs/ }).getAttribute("href"))!, page.url());
  expect(safeBack.origin).toBe(new URL(page.url()).origin);
  expect(safeBack.pathname).toBe("/designs");
  expect(safeBack.searchParams.get("q")).toBe(urlLikeQuery);
  await page.goto(`${designPath}?libraryQuery=${"Q".repeat(501)}`);
  await expect(page.getByRole("link", { name: /Back to designs/ })).toHaveAttribute("href", "/designs");
  await page.goto(`${designPath}?libraryQuery=one&libraryQuery=two`);
  await expect(page.getByRole("link", { name: /Back to designs/ })).toHaveAttribute("href", "/designs");
  await page.goto(`${designPath}?libraryQuery=${encodeURIComponent(query)}`);
  await page.getByRole("link", { name: /Back to designs/ }).click();
  await page.waitForURL(url => url.pathname === "/designs" && url.searchParams.get("q") === query);
  await expect(page.locator(".design-card")).toHaveCount(1);
  await page.locator(".design-card").click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  page.once("dialog", async dialog => { await dialog.dismiss(); });
  await page.getByRole("button", { name: "Delete design", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === `${designPath}/edit` && url.searchParams.get("libraryQuery") === query);
  page.once("dialog", async dialog => { await dialog.accept(); });
  await page.getByRole("button", { name: "Delete design", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/designs" && url.searchParams.get("q") === query);
  await expect(page.locator("input[name='q']")).toHaveValue(query);
  await expect(page.locator(".design-card")).toHaveCount(0);
  expect((await page.request.get(`/api/designs/${id}/image?variant=original`)).status()).toBe(404);
  expect((await page.request.get(`/api/designs/${otherId}/image?variant=original`)).status()).toBe(200);
});

test("linked design appointments show upcoming and complete history with explicit artwork roles and Madrid dates", async ({ page }, testInfo) => {
  await signUp(page);
  const id = await uploadArtwork(page, "Linked tattoo design with a deliberately long title for compact screens");
  const base = Date.now();
  const date = (days: number) => new Date(base + days * 86_400_000).toISOString();
  const appointments = [
    { id: "design-next", startsAt: date(3), status: "CONFIRMED", isFinal: true },
    { id: "design-later", startsAt: date(5), status: "PLANNED", isFinal: false },
    { id: "design-future-completed", startsAt: date(4), status: "COMPLETED", isFinal: true },
    { id: "design-no-show", startsAt: date(2), status: "NO_SHOW", isFinal: false },
    { id: "design-cancelled", startsAt: date(1), status: "CANCELLED", isFinal: true },
    { id: "design-past-planned", startsAt: date(-1), status: "PLANNED", isFinal: false },
    { id: "design-past-confirmed", startsAt: date(-2), status: "CONFIRMED", isFinal: false },
    { id: "design-completed", startsAt: date(-3), status: "COMPLETED", isFinal: true },
  ];
  await withTestDatabase(async pool => {
    const owner = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', ["owner@example.com"]);
    expect(owner.rows).toHaveLength(1);
    const artistId = owner.rows[0].id;
    await pool.query('UPDATE "Design" SET "createdAt"=$1 WHERE id=$2 AND "artistId"=$3', ["2024-01-02T23:30:00.000Z", id, artistId]);
    await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', ["design-client", artistId, "Tattoo Client With A Long Name", "+34611000901"]);
    await pool.query(
      'INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") SELECT x.id,$1,$2,x."startsAt"::timestamp,120,x.status::"AppointmentStatus",now() FROM jsonb_to_recordset($3::jsonb) AS x(id text,"startsAt" text,status text)',
      [artistId, "design-client", JSON.stringify(appointments)],
    );
    await pool.query(
      'INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") SELECT x.id,$1,x."isFinal" FROM jsonb_to_recordset($2::jsonb) AS x(id text,"isFinal" boolean)',
      [id, JSON.stringify(appointments)],
    );
  });
  await page.goto(`/designs/${id}`);
  const upcoming = page.getByRole("region", { name: "Upcoming", exact: true });
  const history = page.getByRole("region", { name: "History", exact: true });
  await expect(upcoming.locator("a[href^='/appointments/']")).toHaveCount(2);
  await expect(history.locator("a[href^='/appointments/']")).toHaveCount(6);
  await expect(page.locator("main")).toContainText("8 appointments");
  const links = page.locator("main a[href^='/appointments/']");
  expect(await links.evaluateAll(elements => elements.map(element => element.getAttribute("href")))).toEqual(appointments.map(appointment => `/appointments/${appointment.id}`));
  for (const appointment of appointments) {
    const row = page.locator(`main a[href='/appointments/${appointment.id}']`);
    await expect(row).toHaveCount(1);
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", appointment.status);
    await expect(row).toContainText(appointment.isFinal ? "Final design" : "Reference");
    await expect(row.locator("time")).toHaveAttribute("datetime", appointment.startsAt);
    await expect(row.locator("time")).toHaveText(new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(appointment.startsAt)));
  }
  const added = page.locator("main time[datetime='2024-01-02T23:30:00.000Z']");
  await expect(added).toHaveText("3 Jan 2024");
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const screenshot = testInfo.outputPath(`design-detail-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`design-detail-${viewport.width}`, { path: screenshot, contentType: "image/png" });
  }
  await page.locator(".app-topbar .language-select").selectOption("es");
  await expect(page.getByRole("region", { name: "Próximas citas", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Historial", exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText("8 citas");
  await expect(page.locator("main a[href='/appointments/design-next']")).toContainText("Diseño final");
  await expect(page.locator("main a[href='/appointments/design-later']")).toContainText("Referencia");
  await expect(page.locator("main a[href='/appointments/design-cancelled'] [data-status]")).toHaveText("Cancelada");
  await expect(page.locator("main a[href='/appointments/design-no-show'] [data-status]")).toHaveText("No presentado");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
