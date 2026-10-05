import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "./fixtures";

const origin = "http://127.0.0.1:3000";
const headers = { Origin: origin };
const password = "Invitation-QA-2026!";
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
    await database(pool => pool.query('UPDATE "user" SET id=$1,"emailVerified"=true,language=\'en\' WHERE id=$2', [fixedId, id]));
    id = fixedId;
  } else {
    await database(pool => pool.query('UPDATE "user" SET language=\'en\',"activatedAt"=CASE WHEN $2 THEN NULL ELSE "activatedAt" END WHERE id=$1', [id, kind === "pending"]));
  }
  // Pending identities use the public language cookie until activation.
  await context.addCookies([{ name: "tattoo-language", value: "en", url: origin }]);
  return { id, email };
}
async function invitation(context: BrowserContext) {
  const response = await context.request.post("/api/admin/invitations", { headers, data: { expiresInDays: 7 } });
  expect(response.status()).toBe(201);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  return await response.json() as { code: string; link: string; invitation: { id: string } };
}

test("only the configured verified admin can open the panel or mutate invitations", async ({ context, page, browser }) => {
  expect((await context.request.post("/api/admin/invitations", { headers, data: {} })).status()).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in$/);
  const owner = await register(context, "Admin", "admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Invite an artist", exact: true })).toBeVisible();
  const created = await invitation(context);
  await database(async pool => {
    const stored = (await pool.query('SELECT "codeHash" FROM beta_invitation WHERE id=$1', [created.invitation.id])).rows[0].codeHash;
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toBe(created.code);
    expect(await page.content()).not.toContain(stored);
  });
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.76.1.2" } });
  try {
    await register(peer, "Kim", "artist");
    const peerPage = await peer.newPage();
    for (const route of ["/admin", "/admin/artists", "/admin/reports"]) {
      await peerPage.goto(route);
      await expect(peerPage).toHaveURL(/\/calendar/);
      expect(await peerPage.content()).not.toContain(owner.email);
    }
    expect((await peer.request.post("/api/admin/invitations", { headers, data: {} })).status()).toBe(403);
    expect((await peer.request.post(`/api/admin/invitations/${created.invitation.id}/revoke`, { headers, data: {} })).status()).toBe(403);
    expect((await context.request.post("/api/admin/invitations", { headers: { Origin: "https://foreign.test" }, data: {} })).status()).toBe(403);
    expect((await context.request.post("/api/admin/invitations", { headers, data: { expiresInDays: 31 } })).status()).toBe(400);
    await database(pool => pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1', [owner.id]));
    expect((await context.request.post("/api/admin/invitations", { headers, data: {} })).status()).toBe(403);
  } finally { await peer.close(); }
});

test("a fragment invitation activates once and later sign-in opens the same workspace without a code", async ({ context, page, browser }) => {
  await register(context, "Admin", "admin");
  await page.goto("/admin");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const codeInput = page.locator("#created-invitation-code");
  await expect(codeInput).toHaveValue(/^TINTA-/);
  const code = await codeInput.inputValue();
  const link = await page.locator("#created-invitation-link").inputValue();
  expect(new URL(link).search).toBe("");
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.76.1.3" } });
  try {
    const owner = await register(peer, "Invited tattoo artist", "pending");
    const peerPage = await peer.newPage();
    await peerPage.goto(link);
    await expect(peerPage.locator("#invitation-code")).toHaveValue(code);
    await expect(peerPage).toHaveURL(url => url.pathname === "/join" && !url.hash);
    expect((await peer.request.get("/api/workspace/sync")).status()).toBe(401);
    await peerPage.getByRole("button", { name: "Activate my workspace", exact: true }).click({ timeout: 15_000 });
    await expect(peerPage).toHaveURL(/\/calendar/);
    const replay = await peer.request.post("/api/invitations/redeem", { headers, data: { code } });
    expect(await replay.json()).toEqual({ status: "already_active" });
    await database(async pool => {
      const redeemed = (await pool.query('SELECT "redeemedById" FROM beta_invitation WHERE "redeemedById"=$1', [owner.id])).rows;
      expect(redeemed).toHaveLength(1);
      await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,"updatedAt") VALUES ($1,$2,$3,$4,now())', ["invite-saved-client", owner.id, "Own saved client", "+34600000000"]);
    });
    await peer.request.post("/api/auth/sign-out", { headers, data: {} });
    expect((await peer.request.post("/api/auth/sign-in/email", { headers, data: { email: owner.email, password } })).status()).toBe(200);
    await peerPage.goto("/calendar");
    await expect(peerPage).toHaveURL(/\/calendar/);
    await peerPage.goto("/clients");
    await expect(peerPage.getByText("Own saved client", { exact: true })).toBeVisible();
    await page.goto("/admin/artists");
    await expect(page.getByText(owner.email, { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain("Own saved client");
  } finally { await peer.close(); }
});

test("revocation blocks activation; pending identities cannot use workspace APIs and can erase their own registration", async ({ context, browser }) => {
  await register(context, "Admin", "admin");
  const created = await invitation(context);
  const revoked = await context.request.post(`/api/admin/invitations/${created.invitation.id}/revoke`, { headers, data: {} });
  expect(await revoked.json()).toEqual({ status: "revoked" });
  const peer = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.76.1.4" } });
  try {
    const owner = await register(peer, "Pending artist", "pending");
    expect((await peer.request.get("/api/workspace/sync")).status()).toBe(401);
    expect((await peer.request.post("/api/designs", { headers, data: {} })).status()).toBe(401);
    const declined = await peer.request.post("/api/invitations/redeem", { headers, data: { code: created.code } });
    expect(declined.status()).toBe(400);
    expect((await declined.json()).error).toBe("INVITATION_UNAVAILABLE");
    const exported = await peer.request.get("/api/account/export");
    expect(exported.status()).toBe(200);
    const body = await exported.json();
    expect(body.profile.activatedAt).toBeNull();
    expect(body.clients).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(created.code);
    const erased = await peer.request.post("/api/account/erase", { headers, data: { confirmation: owner.email, retentionReviewed: true } });
    expect(erased.status()).toBe(200);
    await database(async pool => { expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [owner.id])).rowCount).toBe(0); });
    expect((await peer.request.get("/api/account/export")).status()).toBe(401);
  } finally { await peer.close(); }
});

test("artist statistics paginate without exposing private contents and terminal invitation history expires", async ({ context, page }) => {
  const owner = await register(context, "Admin", "admin");
  await database(async pool => {
    for (let index = 0; index < 51; index++) await pool.query('INSERT INTO "user" (id,name,email,"createdAt","updatedAt") VALUES ($1,$2,$3,now()+$4*interval \'1 second\',now())', [`pagination-${index}`, `Artist ${index}`, `pagination-${index}@example.com`, index]);
    await pool.query('INSERT INTO "Client" (id,"artistId",name,phone,notes,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ["admin-stats-private", owner.id, "CLIENT CONTENT MUST STAY PRIVATE", "+34600000000", "PRIVATE CLIENT NOTES"]);
  });
  await page.goto("/admin/artists");
  await expect(page.getByText("Page 1 / 2", { exact: true })).toBeVisible();
  expect(await page.locator(".admin-artist-row").count()).toBe(50);
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2 / 2", { exact: true })).toBeVisible();
  expect(await page.content()).not.toContain("PRIVATE CLIENT NOTES");
  expect(await page.content()).not.toContain("CLIENT CONTENT MUST STAY PRIVATE");
  const old = await invitation(context);
  await database(pool => pool.query('UPDATE beta_invitation SET "createdAt"=now()-interval \'40 days\',"expiresAt"=now()-interval \'33 days\' WHERE id=$1', [old.invitation.id]));
  const { runPrivacyMaintenance } = await import("../src/lib/privacy-maintenance");
  await runPrivacyMaintenance();
  await database(async pool => { expect((await pool.query('SELECT id FROM beta_invitation WHERE id=$1', [old.invitation.id])).rowCount).toBe(0); });
});
