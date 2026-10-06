import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures";

const origin = "http://127.0.0.1:3000";
const headers = { Origin: origin };
async function database<T>(work: (pool: Pool) => Promise<T>) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) throw new Error("Disposable QA database required");
  const pool = new Pool({ connectionString: url.href });
  try { return await work(pool); } finally { await pool.end(); }
}
async function register(context: BrowserContext, label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  const response = await context.request.post("/api/auth/sign-up/email", { headers, data: { email, name: `QA ${label}`, password: "Privacy-Account-QA-2026!" } });
  expect(response.status()).toBe(200);
  return { id: (await response.json()).user.id as string, email };
}
function logDirectory() {
  const directory = path.resolve(process.env.DIAGNOSTICS_DIR ?? "");
  if (!directory.includes(`${path.sep}.tmp${path.sep}`)) throw new Error("QA private log directory required");
  return directory;
}
async function submitReport(context: BrowserContext, artistId: string) {
  const description = `Private report ${randomUUID()}`;
  const response = await context.request.post("/api/reports", { headers, data: { reportId: randomUUID(), clickedAt: new Date().toISOString(), description, workspaceIdAtClick: artistId, recentEvents: [],
    context: { page: "/settings", view: null, calendarAnchor: null, timezone: "Europe/Madrid", deviceCategory: "desktop", syncState: "current", online: true } } });
  expect(response.status()).toBe(200);
  return description;
}

test("account export includes own privacy records and safe authentication metadata; erasure removes originals, reports and every session", async ({ context, browser }) => {
  const owner = await register(context, "erase-owner");
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.82.1.2" } });
  try {
    const other = await register(peer, "erase-peer");
    const report = await submitReport(context, owner.id);
    const otherReport = await submitReport(peer, other.id);
    const folder = path.resolve(".tmp/e2e-designs", owner.id);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "original.png"), "PRIVATE ART ORIGINAL");
    await writeFile(path.join(folder, "preview.webp"), "PRIVATE ART PREVIEW");
    await database(async pool => {
      await pool.query('INSERT INTO "Design" (id,"artistId","storageKey","previewKey",title,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["privacy-owned-art", owner.id, `${owner.id}/original.png`, `${owner.id}/preview.webp`, "Private owned art"]);
      await pool.query('INSERT INTO "verification" (id,identifier,value,"expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 hour\',now())', ["privacy-reset-row", "reset-password:PRIVATE_RESET_TOKEN", owner.id]);
    });
    const response = await context.request.get("/api/account/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const exported = await response.json();
    expect(exported.profile.diagnosticsConsent).toBe(false);
    expect(exported.accounts[0].providerId).toBe("credential");
    expect(exported.sessions.length).toBeGreaterThan(0);
    expect(exported.reports.some((row: { description: string }) => row.description === report)).toBe(true);
    expect(exported.designs[0].originalUrl).toBe("/api/designs/privacy-owned-art/image?variant=original");
    const serialized = JSON.stringify(exported);
    for (const privateValue of [other.id, otherReport, '"token"', '"password"', '"storageKey"', '"accessToken"', "PRIVATE_RESET_TOKEN", "idempotencyKey", "fingerprint"]) expect(serialized).not.toContain(privateValue);
    const erased = await context.request.post("/api/account/erase", { headers, data: { confirmation: owner.email, retentionReviewed: true } });
    expect(erased.status()).toBe(200);
    expect(await erased.json()).toEqual({ accepted: true, complete: true });
    expect((await context.request.get("/api/account/export")).status()).toBe(401);
    await expect(access(folder)).rejects.toMatchObject({ code: "ENOENT" });
    await database(async pool => {
      expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [owner.id])).rowCount).toBe(0);
      expect((await pool.query('SELECT id FROM "verification" WHERE value=$1', [owner.id])).rowCount).toBe(0);
      expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [other.id])).rowCount).toBe(1);
    });
    const files = (await readdir(logDirectory())).filter(file => /^(reports|diagnostics)-/.test(file));
    const contents = (await Promise.all(files.map(file => readFile(path.join(logDirectory(), file), "utf8")))).join("");
    expect(contents).not.toContain(owner.id);
    expect(contents).not.toContain(report);
    expect(contents).toContain(otherReport);
  } finally { await peer.close(); }
});

test("account erasure requires same-origin exact confirmation, retention review and a recent login", async ({ context }) => {
  const owner = await register(context, "review-owner");
  const valid = { confirmation: owner.email, retentionReviewed: true };
  for (const data of [{ ...valid, arbitrary: true }, { ...valid, retentionReviewed: false }, { ...valid, confirmation: "other@example.com" }]) {
    expect((await context.request.post("/api/account/erase", { headers, data })).status()).toBe(400);
  }
  expect((await context.request.post("/api/account/erase", { headers: { Origin: "https://foreign.test" }, data: valid })).status()).toBe(403);
  expect((await context.request.post("/api/account/erase", { headers, data: "x".repeat(3000) })).status()).toBe(400);
  await database(pool => pool.query('UPDATE "session" SET "createdAt"=now()-interval \'11 minutes\' WHERE "userId"=$1', [owner.id]));
  const old = await context.request.post("/api/account/erase", { headers, data: valid });
  expect(old.status()).toBe(403);
  expect((await old.json()).error).toBe("reauthenticate");
  expect((await context.request.get("/api/account/export")).status()).toBe(200);
});

test("failed private-file cleanup retains a durable erasure instruction and revokes access without a false completion", async ({ context }) => {
  const owner = await register(context, "pending-owner");
  // A malformed report file reproduces a real cleanup failure without changing
  // permissions or touching any non-QA installation.
  const directory = logDirectory();
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const previous = await readFile(filename, "utf8").catch(() => "");
  try {
    await writeFile(filename, `${previous}{"partial":`);
    const response = await context.request.post("/api/account/erase", { headers, data: { confirmation: owner.email, retentionReviewed: true } });
    expect(response.status()).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, complete: false });
    await database(async pool => {
      const result = await pool.query('SELECT "deletionRequestedAt" FROM "user" WHERE id=$1', [owner.id]);
      expect(result.rows[0].deletionRequestedAt).toBeTruthy();
      expect((await pool.query('SELECT id FROM "session" WHERE "userId"=$1', [owner.id])).rowCount).toBe(0);
    });
    expect((await context.request.get("/api/account/export")).status()).toBe(401);
    expect((await context.request.post("/api/auth/sign-in/email", { headers, data: { email: owner.email, password: "Privacy-Account-QA-2026!" } })).ok()).toBe(false);
  } finally { await writeFile(filename, previous); }
});

test("public legal pages work before login in both languages and fit mobile; optional consent is separate from signup", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const lang of ["es", "en"]) for (const route of ["privacy", "cookies", "legal"]) {
    await page.goto(`/${route}?lang=${lang}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByRole("link", { name: lang === "es" ? "Iniciar sesión" : "Sign in", exact: true })).toBeVisible();
  }
  await page.goto("/sign-in");
  await expect(page.locator('input[type=checkbox]')).not.toBeChecked();
  await expect(page.getByRole("link", { name: "Privacidad", exact: true })).toBeVisible();
});
