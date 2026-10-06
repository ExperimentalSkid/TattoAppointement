import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "./fixtures";

const origin = "http://127.0.0.1:3000";
const headers = { Origin: origin };
const password = "Access-QA-2026!";
async function database<T>(work: (pool: Pool) => Promise<T>) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) throw new Error("Disposable QA database required");
  const pool = new Pool({ connectionString: url.href });
  try { return await work(pool); } finally { await pool.end(); }
}
async function register(context: BrowserContext, label: string, kind: "admin" | "pending" | "artist" = "artist") {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID()}@example.com`;
  const response = await context.request.post("/api/auth/sign-up/email", { headers, data: { email, name: label, password } });
  expect(response.status()).toBe(200);
  let id = (await response.json()).user.id as string;
  if (kind === "admin") {
    const fixedId = process.env.TINTA_ADMIN_USER_ID;
    if (fixedId !== "tinta-e2e-admin") throw new Error("Fixed disposable QA admin identity required");
    await database(pool => pool.query('UPDATE "user" SET id=$1,"emailVerified"=true,"activatedAt"=now(),language=\'en\' WHERE id=$2', [fixedId, id]));
    id = fixedId;
  } else {
    await database(pool => pool.query('UPDATE "user" SET language=\'en\',"activatedAt"=CASE WHEN $2 THEN NULL ELSE now() END WHERE id=$1', [id, kind === "pending"]));
  }
  await context.addCookies([{ name: "tattoo-language", value: "en", url: origin }]);
  return { id, email };
}
function access(context: BrowserContext, id: string, enabled: boolean, expectedDeactivatedAt: string | null) {
  return context.request.post(`/api/admin/artists/${id}/access`, { headers, data: { enabled, expectedDeactivatedAt } });
}

test("access administration protects the operator and invitation boundary, validates requests and fails closed", async ({ context, browser }) => {
  const owner = await register(context, "Administrator", "admin");
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.77.1.1" } });
  try {
    const artist = await register(peer, "Pending artist", "pending");
    expect((await access(peer, owner.id, false, null)).status()).toBe(403);
    expect((await access(context, owner.id, false, null)).status()).toBe(403);
    for (const enabled of [true, false]) {
      const response = await access(context, artist.id, enabled, null);
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({ error: "invitation_required" });
    }
    expect((await access(context, "missing-artist", false, null)).status()).toBe(404);
    expect((await context.request.post(`/api/admin/artists/${artist.id}/access`, { headers: { Origin: "https://foreign.test" }, data: { enabled: false, expectedDeactivatedAt: null } })).status()).toBe(403);
    for (const data of [{ enabled: true }, { enabled: "true", expectedDeactivatedAt: null }, { enabled: true, expectedDeactivatedAt: null, activatedAt: "2026-01-01" }]) {
      expect((await context.request.post(`/api/admin/artists/${artist.id}/access`, { headers, data })).status()).toBe(400);
    }
    await database(pool => pool.query('UPDATE "user" SET "activatedAt"=now(),"deletionRequestedAt"=now() WHERE id=$1', [artist.id]));
    const changed = await access(context, artist.id, false, null);
    expect(changed.status()).toBe(409);
    expect(await changed.json()).toEqual({ error: "account_changed" });
    await database(pool => pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1', [owner.id]));
    expect((await access(context, artist.id, false, null)).status()).toBe(403);
  } finally { await peer.close(); }
});

test("pausing blocks every existing device while preserving records, identity privacy and later access", async ({ context, browser }) => {
  await register(context, "Administrator", "admin");
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.77.1.2" } });
  const second = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.77.1.3" } });
  try {
    const artist = await register(peer, "Tattoo artist");
    await database(async pool => {
      await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', ["access-preserved-client", artist.id, "Preserved client", "+34600000000"]);
      await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes","updatedAt") VALUES ($1,$2,$3,$4,120,now())', ["access-preserved-appointment", artist.id, "access-preserved-client", "2026-10-05T12:00:00Z"]);
    });
    expect((await second.request.post("/api/auth/sign-in/email", { headers, data: { email: artist.email, password } })).status()).toBe(200);
    const before = await database(async pool => (await pool.query('SELECT "activatedAt","updatedAt" FROM "user" WHERE id=$1', [artist.id])).rows[0]);
    const sessionsBefore = await database(async pool => (await pool.query('SELECT id FROM session WHERE "userId"=$1', [artist.id])).rows.map(row => row.id).sort());
    const paused = await access(context, artist.id, false, null);
    expect(paused.status()).toBe(200);
    expect(paused.headers()["cache-control"]).toBe("private, no-store");
    const state = (await paused.json()).artist as { id: string; enabled: boolean; deactivatedAt: string };
    expect(state).toMatchObject({ id: artist.id, enabled: false });
    expect(new Date(state.deactivatedAt).toISOString()).toBe(state.deactivatedAt);
    for (const device of [peer, second]) {
      expect((await device.request.get("/api/workspace/sync")).status()).toBe(401);
      expect((await device.request.post("/api/designs", { headers, data: {} })).status()).toBe(401);
      expect((await device.request.get("/api/clients/access-preserved-client/export")).status()).toBe(401);
      const page = await device.newPage();
      await page.goto("/calendar");
      await expect(page).toHaveURL(/\/account-paused$/);
      expect(await page.content()).not.toContain("Preserved client");
    }
    // Authenticating again keeps own privacy accessible; it grants no workspace.
    expect((await peer.request.post("/api/auth/sign-in/email", { headers, data: { email: artist.email, password } })).status()).toBe(200);
    const invitation = await context.request.post("/api/admin/invitations", { headers, data: {} });
    expect(invitation.status()).toBe(201);
    const created = await invitation.json();
    const declined = await peer.request.post("/api/invitations/redeem", { headers, data: { code: created.code } });
    expect(declined.status()).toBe(403);
    expect(await declined.json()).toEqual({ error: "account_paused" });
    await database(async pool => {
      expect((await pool.query('SELECT "redeemedAt" FROM beta_invitation WHERE id=$1', [created.invitation.id])).rows[0].redeemedAt).toBeNull();
      expect((await pool.query('SELECT "userId" FROM invitation_attempt_window WHERE "userId"=$1', [artist.id])).rowCount).toBe(0);
    });
    const exported = await peer.request.get("/api/account/export");
    expect(exported.status()).toBe(200);
    const body = await exported.json();
    expect(body.profile.deactivatedAt).toBe(state.deactivatedAt);
    expect(body.clients.map((client: { id: string }) => client.id)).toEqual(["access-preserved-client"]);
    expect(body.appointments.map((appointment: { id: string }) => appointment.id)).toEqual(["access-preserved-appointment"]);
    const restored = await access(context, artist.id, true, state.deactivatedAt);
    expect(await restored.json()).toEqual({ artist: { id: artist.id, enabled: true, deactivatedAt: null } });
    for (const device of [peer, second]) expect((await device.request.get("/api/workspace/sync")).status()).toBe(200);
    const after = await database(async pool => (await pool.query('SELECT "activatedAt","updatedAt" FROM "user" WHERE id=$1', [artist.id])).rows[0]);
    expect(after.activatedAt).toEqual(before.activatedAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
    const sessionsAfter = await database(async pool => (await pool.query('SELECT id FROM session WHERE "userId"=$1', [artist.id])).rows.map(row => row.id));
    expect(sessionsBefore.every(id => sessionsAfter.includes(id))).toBe(true);
    const page = await second.newPage();
    await page.goto("/clients");
    await expect(page.getByText("Preserved client", { exact: true })).toBeVisible();
  } finally { await peer.close(); await second.close(); }
});

test("concurrent access changes return authoritative conflicts and paused identities can erase their own account", async ({ context, browser }) => {
  await register(context, "Administrator", "admin");
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.77.1.4" } });
  try {
    const artist = await register(peer, "Erase paused account");
    const results = await Promise.all([access(context, artist.id, false, null), access(context, artist.id, false, null)]);
    expect(results.map(result => result.status()).sort()).toEqual([200, 409]);
    const success = await results.find(result => result.status() === 200)!.json();
    const conflict = await results.find(result => result.status() === 409)!.json();
    expect(conflict).toEqual({ error: "access_conflict", artist: success.artist });
    const staleRestore = await access(context, artist.id, true, null);
    expect(staleRestore.status()).toBe(409);
    expect(await staleRestore.json()).toEqual(conflict);
    // A repeated instruction with the current timestamp is idempotent.
    expect(await (await access(context, artist.id, false, success.artist.deactivatedAt)).json()).toEqual(success);
    const erased = await peer.request.post("/api/account/erase", { headers, data: { confirmation: artist.email, retentionReviewed: true } });
    expect(erased.status()).toBe(200);
    await database(async pool => { expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [artist.id])).rowCount).toBe(0); });
    expect((await peer.request.get("/api/account/export")).status()).toBe(401);
    expect((await access(context, artist.id, true, success.artist.deactivatedAt)).status()).toBe(404);
  } finally { await peer.close(); }
});
