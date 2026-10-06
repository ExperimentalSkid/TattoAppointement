import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "./fixtures";

const origin = "http://127.0.0.1:3000";
const headers = { Origin: origin };

async function database<T>(work: (pool: Pool) => Promise<T>) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) throw new Error("Disposable account-access QA database required");
  const pool = new Pool({ connectionString: url.href });
  try { return await work(pool); } finally { await pool.end(); }
}

async function register(context: BrowserContext, name: string, administrator = false) {
  const email = `access-ui-${randomUUID()}@example.com`;
  const response = await context.request.post("/api/auth/sign-up/email", { headers, data: { name, email, password: "Access-UI-QA-2026!" } });
  expect(response.status()).toBe(200);
  let id = (await response.json()).user.id as string;
  if (administrator) {
    if (process.env.TINTA_ADMIN_USER_ID !== "tinta-e2e-admin") throw new Error("The fixed disposable QA administrator is required");
    await database(pool => pool.query('UPDATE "user" SET id=$1,"emailVerified"=true,"activatedAt"=now(),language=\'en\' WHERE id=$2', [process.env.TINTA_ADMIN_USER_ID, id]));
    id = process.env.TINTA_ADMIN_USER_ID;
  } else {
    // The same UI tests also work in the invitation-required installation.
    await database(pool => pool.query('UPDATE "user" SET "activatedAt"=now(),language=\'en\' WHERE id=$1', [id]));
  }
  await context.addCookies([{ name: "tattoo-language", value: "en", url: origin }]);
  return { id, name, email };
}

function artistRow(page: Page, name: string) {
  return page.locator(".admin-artist-row").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

async function phoneAndKeyboardGeometry(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const dimensions = await control.boundingBox();
  expect(dimensions).not.toBeNull();
  expect(dimensions!.height).toBeGreaterThanOrEqual(44);
  expect(dimensions!.width).toBeGreaterThanOrEqual(44);
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("artist switches work in both languages and widths while protected accounts stay disabled", async ({ context, page, browser }) => {
  const admin = await register(context, "Operator", true);
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.65.19.11" } });
  const output = path.resolve(".tmp/admin-layouts");
  await mkdir(output, { recursive: true });
  try {
    const artist = await register(peer, "Invited artist");
    await database(async pool => {
      await pool.query('INSERT INTO "user" (id,name,email,"createdAt","updatedAt","activatedAt","deletionRequestedAt") VALUES ($1,$2,$3,now(),now(),NULL,NULL),($4,$5,$6,now(),now(),now(),now())', ["access-ui-pending", "Pending artist", "access-ui-pending@example.com", "access-ui-erasure", "Erasure artist", "access-ui-erasure@example.com"]);
      await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', ["access-ui-client", artist.id, "Preserved private client", "+34600000001"]);
    });
    for (const locale of ["en", "es"] as const) {
      await database(pool => pool.query('UPDATE "user" SET language=$1 WHERE id=$2', [locale, admin.id]));
      await context.addCookies([{ name: "tattoo-language", value: locale, url: origin }]);
      for (const viewport of [{ label: "phone", width: 360, height: 800 }, { label: "desktop", width: 1440, height: 1000 }]) {
        await page.setViewportSize(viewport);
        await page.goto("/admin/artists");
        const operator = artistRow(page, admin.name);
        await expect(operator.getByRole("switch")).toBeDisabled();
        await expect(operator.getByText(locale === "es" ? "Tu cuenta de administrador" : "Your administrator account", { exact: true })).toBeVisible();
        await expect(artistRow(page, "Pending artist").getByRole("switch")).toBeDisabled();
        await expect(artistRow(page, "Erasure artist").getByRole("switch")).toBeDisabled();
        const row = artistRow(page, artist.name);
        const control = row.getByRole("switch", { name: locale === "es" ? `Acceso al estudio de ${artist.name}` : `Workspace access for ${artist.name}`, exact: true });
        await expect(control).toHaveAttribute("aria-checked", "true");
        await phoneAndKeyboardGeometry(page, control);
        await page.keyboard.press("Space");
        await expect(control).toHaveAttribute("aria-checked", "false");
        await expect(row.getByRole("status")).toHaveText(locale === "es" ? "Acceso pausado. Sus registros se conservan." : "Access paused. Their records are kept.");
        expect((await peer.request.get("/api/workspace/sync")).status()).toBe(401);
        await expect(row.locator(".admin-identity-state")).toContainText(locale === "es" ? "Pausada" : "Paused");
        await page.screenshot({ path: path.join(output, `${locale}-${viewport.label}-artist-access-paused.png`), fullPage: true });
        await control.focus();
        await page.keyboard.press("Enter");
        await expect(control).toHaveAttribute("aria-checked", "true");
        expect((await peer.request.get("/api/workspace/sync")).status()).toBe(200);
        const client = await database(pool => pool.query('SELECT name FROM "Client" WHERE "artistId"=$1', [artist.id]));
        expect(client.rows).toEqual([{ name: "Preserved private client" }]);
      }
    }
  } finally { await peer.close(); }
});

test("failed switch requests preserve access, prevent duplicate submission and can be retried", async ({ context, page, browser }) => {
  await register(context, "Operator", true);
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.65.19.12" } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const artist = await register(peer, "Connection QA artist");
    const bodies: unknown[] = [];
    await page.route(`**/api/admin/artists/${artist.id}/access`, async route => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) { await gate; await route.abort("failed"); }
      else if (bodies.length === 2) await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
      else await route.continue();
    });
    await page.goto("/admin/artists");
    const row = artistRow(page, artist.name);
    const control = row.getByRole("switch");
    await control.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute("aria-busy", "true");
    await expect(control).toHaveAttribute("aria-checked", "true");
    expect(bodies).toHaveLength(1);
    release();
    await expect(row.getByRole("alert")).toContainText("The previous access setting is kept.");
    await expect(control).toBeEnabled();
    expect((await peer.request.get("/api/workspace/sync")).status()).toBe(200);
    await row.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(control).toHaveAttribute("aria-checked", "true");
    await expect(control).toBeEnabled();
    await row.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(control).toHaveAttribute("aria-checked", "false");
    await expect(row.getByRole("alert")).toHaveCount(0);
    expect(bodies).toEqual(Array.from({ length: 3 }, () => ({ enabled: false, expectedDeactivatedAt: null })));
    expect((await peer.request.get("/api/workspace/sync")).status()).toBe(401);
  } finally { release(); await peer.close(); }
});

test("a stale switch uses the returned current state before the server refresh completes", async ({ context, page, browser }) => {
  await register(context, "Operator", true);
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.65.19.13" } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const artist = await register(peer, "Concurrent QA artist");
    await page.goto("/admin/artists");
    const row = artistRow(page, artist.name);
    const control = row.getByRole("switch");
    await expect(control).toHaveAttribute("aria-checked", "true");
    const pauseDate = new Date("2026-10-06T08:09:10.000Z").toISOString();
    await database(pool => pool.query('UPDATE "user" SET "deactivatedAt"=$1 WHERE id=$2', [pauseDate, artist.id]));
    let held = false;
    await page.route("**/admin/artists?*", async route => {
      if (!held && route.request().headers().rsc === "1") { held = true; await gate; }
      await route.continue();
    });
    const conflict = page.waitForResponse(response => response.url().endsWith(`/api/admin/artists/${artist.id}/access`) && response.status() === 409);
    await control.click();
    await conflict;
    await expect(control).toHaveAttribute("aria-checked", "false");
    await expect(row.getByRole("alert")).toContainText("Access has changed.");
    const retried = page.waitForRequest(request => request.url().endsWith(`/api/admin/artists/${artist.id}/access`));
    await row.getByRole("button", { name: "Retry", exact: true }).click();
    expect((await retried).postDataJSON()).toEqual({ enabled: true, expectedDeactivatedAt: pauseDate });
    await expect(control).toHaveAttribute("aria-checked", "true");
    release();
    await page.reload();
    await expect(control).toHaveAttribute("aria-checked", "true");
    expect((await peer.request.get("/api/workspace/sync")).status()).toBe(200);
  } finally { release(); await peer.close(); }
});

test("paused artists keep their own export and erasure controls in both languages on phone and desktop", async ({ context, page }) => {
  const artist = await register(context, "Paused QA artist");
  await database(async pool => {
    await pool.query('UPDATE "user" SET "deactivatedAt"=now() WHERE id=$1', [artist.id]);
    await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', ["paused-ui-client", artist.id, "Own paused client", "+34600000002"]);
  });
  const output = path.resolve(".tmp/admin-layouts");
  await mkdir(output, { recursive: true });
  for (const locale of ["en", "es"] as const) {
    await context.addCookies([{ name: "tattoo-language", value: locale, url: origin }]);
    for (const viewport of [{ label: "phone", width: 360, height: 800 }, { label: "desktop", width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/account-paused");
      await expect(page.getByRole("heading", { name: locale === "es" ? "Tu estudio está en pausa" : "Your workspace is paused", exact: true })).toBeVisible();
      await expect(page.getByText(artist.email, { exact: true })).toBeVisible();
      await expect(page.locator(".app-shell")).toHaveCount(0);
      await expect(page.getByRole("link", { name: locale === "es" ? "Privacidad" : "Privacy", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: locale === "es" ? "Cerrar sesión" : "Sign out", exact: true })).toBeVisible();
      const check = page.getByRole("button", { name: locale === "es" ? "Comprobar acceso" : "Check access", exact: true });
      await phoneAndKeyboardGeometry(page, check);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/account-paused$/);
      const deletion = page.locator(".paused-account-data details");
      await deletion.locator("summary").click();
      await expect(deletion.getByRole("button", { name: locale === "es" ? "Eliminar permanentemente mi espacio" : "Permanently delete my workspace", exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(output, `${locale}-${viewport.label}-account-paused.png`), fullPage: true });
    }
  }
  for (const route of ["/sign-in", "/sign-up", "/join", "/calendar", "/clients", "/settings"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/account-paused$/);
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar mis datos", exact: true }).click();
  const saved = await (await download).path();
  expect(saved).not.toBeNull();
  const exported = JSON.parse(await readFile(saved!, "utf8"));
  expect(exported.profile).toMatchObject({ id: artist.id, email: artist.email });
  expect(exported.profile.deactivatedAt).not.toBeNull();
  expect(exported.clients).toEqual([expect.objectContaining({ name: "Own paused client" })]);
  await page.locator(".paused-account-data summary").click();
  await page.locator("#erase-account-email").fill(artist.email);
  await page.locator('[name="retentionReviewed"]').check();
  await page.getByRole("button", { name: "Eliminar permanentemente mi espacio", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy\?erasure=(complete|pending)&lang=es$/);
  await database(async pool => { expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [artist.id])).rowCount).toBe(0); });
});
