import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "./fixtures";

const origin = "http://127.0.0.1:3000";
const requestHeaders = { Origin: origin };

async function withTestDatabase<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Client privacy QA requires the explicitly disposable _e2e database.");
  }
  const pool = new Pool({ connectionString: url.href });
  try { return await run(pool); } finally { await pool.end(); }
}

async function register(context: BrowserContext, label: string) {
  const response = await context.request.post("/api/auth/sign-up/email", {
    headers: requestHeaders,
    data: { name: `Privacy artist ${label}`, email: `${label}-${randomUUID()}@example.com`, password: "Client-Privacy-QA-2026!" },
  });
  expect(response.status()).toBe(200);
  expect((await context.request.post("/api/preferences/language", { headers: requestHeaders, data: { language: "en" } })).status()).toBe(200);
  return (await response.json()).user.id as string;
}

async function seed(artistId: string, label = "primary") {
  const id = `client-privacy-${label}-${randomUUID()}`;
  const otherClientId = `${id}-other`;
  const appointmentId = `${id}-appointment`;
  const otherAppointmentId = `${id}-other-appointment`;
  const designId = `${id}-shared-artwork`;
  const name = `Privacy client ${label}`;
  const expectedVersion = await withTestDatabase(async pool => {
    const clients = await pool.query<{ updatedAt: Date }>(
      'INSERT INTO "Client" (id,"artistId",name,phone,email,notes,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now()),($7,$2,$8,$9,null,$10,now()) RETURNING "updatedAt"',
      [id, artistId, name, "+34611001122", "client@example.test", "Client-only private notes", otherClientId, "Other client's private name", "+34611001123", "Unrelated client secret"],
    );
    await pool.query('INSERT INTO "Design" (id,"artistId","storageKey",title,notes,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
      [designId, artistId, `${id}-private-storage.png`, "Shared library artwork", "Shared notes stay in library"]);
    await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"agreedPrice","updatedAt") VALUES ($1,$2,$3,$4,90,\'COMPLETED\',200,now()),($5,$2,$6,$4,90,\'PLANNED\',300,now())',
      [appointmentId, artistId, id, "2026-01-10T12:00:00.000Z", otherAppointmentId, otherClientId]);
    await pool.query('INSERT INTO "Payment" (id,"artistId","appointmentId",amount) VALUES ($1,$2,$3,50),($4,$2,$5,75)',
      [`${id}-payment`, artistId, appointmentId, `${id}-other-payment`, otherAppointmentId]);
    await pool.query('INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") VALUES ($1,$2,true),($3,$2,false)',
      [appointmentId, designId, otherAppointmentId]);
    const current = await pool.query<{ updatedAt: Date }>('SELECT "updatedAt" FROM "Client" WHERE id=$1', [id]);
    expect(current.rows[0].updatedAt.toISOString(), "SQL fixture version should match its created client").toBe(clients.rows[0].updatedAt.toISOString());
    return current.rows[0].updatedAt.toISOString();
  });
  return { id, otherClientId, appointmentId, otherAppointmentId, designId, name, expectedVersion };
}

function instruction(record: Awaited<ReturnType<typeof seed>>) {
  return { confirmation: record.name, expectedVersion: record.expectedVersion, retentionReviewed: true, artworkReviewed: true };
}

async function erase(request: APIRequestContext, record: Awaited<ReturnType<typeof seed>>, data = instruction(record)) {
  return request.post(`/api/clients/${record.id}/erase`, { headers: requestHeaders, data });
}

test("client export contains only the authenticated artist's selected client and safe linked metadata", async ({ context, browser }) => {
  const artistId = await register(context, "export-owner");
  const record = await seed(artistId);
  const exported = await context.request.get(`/api/clients/${record.id}/export`);
  expect((await exported.json()).client.updatedAt, "SQL seed and public export versions should agree").toBe(record.expectedVersion);
  const second = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.81.0.2" } });
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const peerId = await register(second, "export-peer");
    const peer = await seed(peerId, "peer");
    // Deliberately malformed foreign associations in the guarded disposable DB
    // must be filtered from export and never expose another artist's identifiers.
    await withTestDatabase(async pool => {
      await pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") VALUES ($1,$2,$3,now(),60,\'PLANNED\',now())', ["privacy-foreign-appointment", peerId, record.id]);
      await pool.query('INSERT INTO "Payment" (id,"artistId","appointmentId",amount) VALUES ($1,$2,$3,10)', ["privacy-foreign-payment", peerId, record.appointmentId]);
      await pool.query('INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") VALUES ($1,$2,false)', [record.appointmentId, peer.designId]);
    });
    const response = await context.request.get(`/api/clients/${record.id}/export`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toBe('attachment; filename="tinta-client-data.json"');
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    const payload = await response.json();
    expect(payload.client.id).toBe(record.id);
    expect(payload.client.notes).toBe("Client-only private notes");
    expect(payload.appointments.map((row: { id: string }) => row.id)).toEqual([record.appointmentId]);
    expect(payload.payments.map((row: { id: string }) => row.id)).toEqual([`${record.id}-payment`]);
    expect(payload.designs.map((row: { id: string }) => row.id)).toEqual([record.designId]);
    expect(payload.designs[0].originalUrl).toBe(`/api/designs/${record.designId}/image?variant=original`);
    const serialized = JSON.stringify(payload);
    for (const privateValue of [record.otherClientId, record.otherAppointmentId, peer.id, peer.designId, "privacy-foreign", "storageKey", "password", "accessToken", "Unrelated client secret", "Shared notes stay in library"]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect((await visitor.request.get(`/api/clients/${record.id}/export`)).status()).toBe(401);
    expect((await erase(visitor.request, record)).status()).toBe(401);
    expect((await second.request.get(`/api/clients/${record.id}/export`)).status()).toBe(404);
    expect((await erase(second.request, record)).status()).toBe(404);
  } finally { await second.close(); await visitor.close(); }
});

test("client erasure requires same origin, exact confirmation, strict bounded JSON and a recent sign-in", async ({ context }) => {
  const artistId = await register(context, "erase-validation");
  const record = await seed(artistId);
  expect((await context.request.post(`/api/clients/${record.id}/erase`, { headers: { Origin: "https://other.example" }, data: instruction(record) })).status()).toBe(403);
  for (const data of [
    { ...instruction(record), retentionReviewed: false }, { ...instruction(record), artworkReviewed: false },
    { ...instruction(record), unexpected: true }, { ...instruction(record), confirmation: "Not the client" },
    { ...instruction(record), expectedVersion: "yesterday" },
  ]) {
    const response = await context.request.post(`/api/clients/${record.id}/erase`, { headers: requestHeaders, data });
    expect(response.status(), JSON.stringify(await response.json())).toBe(400);
  }
  expect((await context.request.post(`/api/clients/${record.id}/erase`, { headers: { ...requestHeaders, "Content-Type": "text/plain" }, data: JSON.stringify(instruction(record)) })).status()).toBe(400);
  expect((await context.request.post(`/api/clients/${record.id}/erase`, { headers: requestHeaders, data: { ...instruction(record), extra: "x".repeat(2048) } })).status()).toBe(413);
  await withTestDatabase(pool => pool.query('UPDATE "session" SET "createdAt" = now() - interval \'11 minutes\' WHERE "userId" = $1', [artistId]));
  const oldSession = await erase(context.request, record);
  expect(oldSession.status()).toBe(403);
  expect((await oldSession.json()).error).toBe("reauthenticate");
  expect((await context.request.get(`/api/clients/${record.id}/export`)).status()).toBe(200);
});

test("client erasure rejects peer associations before deleting owned history and preserves shared artwork", async ({ context, browser }) => {
  const artistId = await register(context, "erase-owner");
  const record = await seed(artistId);
  const second = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": "10.82.0.2" } });
  try {
    const peerId = await register(second, "erase-peer");
    const peer = await seed(peerId, "peer");
    const corruptId = "privacy-corrupt-record";
    await withTestDatabase(pool => pool.query('INSERT INTO "Appointment" (id,"artistId","clientId","startsAt","durationMinutes",status,"updatedAt") VALUES ($1,$2,$3,now(),60,\'PLANNED\',now())', [corruptId, peerId, record.id]));
    expect((await erase(context.request, record)).status()).toBe(409);
    await withTestDatabase(async pool => {
      expect((await pool.query('SELECT id FROM "Appointment" WHERE id=$1', [corruptId])).rowCount).toBe(1);
      await pool.query('DELETE FROM "Appointment" WHERE id=$1', [corruptId]);
      await pool.query('INSERT INTO "Payment" (id,"artistId","appointmentId",amount) VALUES ($1,$2,$3,10)', [corruptId, peerId, record.appointmentId]);
    });
    expect((await erase(context.request, record)).status()).toBe(409);
    await withTestDatabase(async pool => {
      expect((await pool.query('SELECT id FROM "Payment" WHERE id=$1', [corruptId])).rowCount).toBe(1);
      expect((await pool.query('SELECT id FROM "Payment" WHERE id=$1', [`${record.id}-payment`])).rowCount).toBe(1);
      await pool.query('DELETE FROM "Payment" WHERE id=$1', [corruptId]);
      await pool.query('INSERT INTO "AppointmentDesign" ("appointmentId","designId","isFinal") VALUES ($1,$2,false)', [record.appointmentId, peer.designId]);
    });
    expect((await erase(context.request, record)).status()).toBe(409);
    await withTestDatabase(pool => pool.query('DELETE FROM "AppointmentDesign" WHERE "appointmentId"=$1 AND "designId"=$2', [record.appointmentId, peer.designId]));
    const accepted = await erase(context.request, record);
    expect(accepted.status(), JSON.stringify(await accepted.json())).toBe(200);
    expect(await accepted.json()).toEqual({ erased: true });
    expect((await erase(context.request, record)).status()).toBe(404);
    await withTestDatabase(async pool => {
      for (const [table, id] of [["Client", record.id], ["Appointment", record.appointmentId], ["Payment", `${record.id}-payment`]]) {
        expect((await pool.query(`SELECT id FROM "${table}" WHERE id=$1`, [id])).rowCount).toBe(0);
      }
      expect((await pool.query('SELECT id FROM "Client" WHERE id IN ($1,$2)', [record.otherClientId, peer.id])).rowCount).toBe(2);
      expect((await pool.query('SELECT id FROM "Design" WHERE id IN ($1,$2)', [record.designId, peer.designId])).rowCount).toBe(2);
      expect((await pool.query('SELECT "designId" FROM "AppointmentDesign" WHERE "appointmentId"=$1', [record.otherAppointmentId])).rows[0].designId).toBe(record.designId);
      expect((await pool.query('SELECT id FROM "Payment" WHERE id=$1', [`${record.id}-other-payment`])).rowCount).toBe(1);
    });
  } finally { await second.close(); }
});

test("client erasure rejects a concurrent stale review and accepts at most one duplicate instruction", async ({ context }) => {
  const artistId = await register(context, "erase-concurrent");
  const record = await seed(artistId);
  await withTestDatabase(async pool => {
    const blocker = await pool.connect();
    let attempt: ReturnType<typeof erase> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [artistId]);
      attempt = erase(context.request, record);
      await expect.poll(async () => (await pool.query("SELECT count(*)::integer AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")).rows[0].count).toBeGreaterThan(0);
      await blocker.query('UPDATE "Client" SET notes=$1,"updatedAt"=now() WHERE id=$2', ["Changed after review", record.id]);
      await blocker.query("COMMIT");
      expect((await attempt).status()).toBe(409);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); if (attempt) await attempt; }
  });
  const response = await context.request.get(`/api/clients/${record.id}/export`);
  record.expectedVersion = (await response.json()).client.updatedAt;
  const results = await Promise.all([erase(context.request, record), erase(context.request, record)]);
  const statuses = results.map(result => result.status());
  expect(statuses.filter(status => status === 200)).toHaveLength(1);
  expect(statuses.every(status => [200, 404, 409].includes(status))).toBe(true);
  expect((await context.request.get(`/api/clients/${record.id}/export`)).status()).toBe(404);
});

test("client privacy UI keeps review drafts after a failed request, requires manual retry and downloads a generic file", async ({ page, context }) => {
  const artistId = await register(context, "privacy-ui");
  const record = await seed(artistId);
  await page.goto(`/clients/${record.id}`);
  const tools = page.locator(".client-privacy-tools");
  await expect(tools).not.toHaveAttribute("open");
  await tools.locator("summary").click();
  await expect(tools).toContainText("Artwork stays in your shared library");
  await expect(tools).toContainText("They are not the client's GDPR consent");
  const confirmation = tools.locator('input[name="confirmation"]');
  const retention = tools.locator('input[name="retentionReviewed"]');
  const artwork = tools.locator('input[name="artworkReviewed"]');
  await confirmation.fill(record.name);
  await retention.check();
  await artwork.check();
  let requests = 0;
  await page.route(`**/api/clients/${record.id}/erase`, async route => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
    else await route.continue();
  });
  await tools.getByRole("button", { name: "Permanently erase client history", exact: true }).click();
  await expect(tools.getByRole("alert")).toContainText("retry manually");
  await expect(confirmation).toHaveValue(record.name);
  await expect(retention).toBeChecked();
  await expect(artwork).toBeChecked();
  await expect(tools).toHaveAttribute("data-sync-dirty", "true");
  expect(requests).toBe(1);

  const downloadEvent = page.waitForEvent("download");
  await tools.getByRole("button", { name: "Download client data", exact: false }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("tinta-client-data.json");
  const downloaded = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(downloaded.client.id).toBe(record.id);
  expect(downloaded.appointments).toHaveLength(1);
  await tools.getByRole("button", { name: "Retry erasure", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/clients");
  expect(requests).toBe(2);
});

test("client privacy UI rejects a non-JSON download and explains recent sign-in without discarding confirmations", async ({ page, context }) => {
  const artistId = await register(context, "privacy-ui-auth");
  const record = await seed(artistId);
  await page.goto(`/clients/${record.id}`);
  const tools = page.locator(".client-privacy-tools");
  await tools.locator("summary").click();
  await page.route(`**/api/clients/${record.id}/export`, route => route.fulfill({ status: 200, contentType: "text/html", body: "<html>Not client data</html>" }));
  await tools.getByRole("button", { name: "Download client data", exact: false }).click();
  await expect(tools.getByRole("alert")).toContainText("Could not download valid client data");
  await tools.locator('input[name="confirmation"]').fill(record.name);
  await tools.locator('input[name="retentionReviewed"]').check();
  await tools.locator('input[name="artworkReviewed"]').check();
  await withTestDatabase(pool => pool.query('UPDATE "session" SET "createdAt"=now() - interval \'11 minutes\' WHERE "userId"=$1', [artistId]));
  await tools.getByRole("button", { name: "Permanently erase client history", exact: true }).click();
  await expect(tools.getByRole("alert").filter({ hasText: "last 10 minutes" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/clients/${record.id}$`));
  await expect(tools.locator('input[name="confirmation"]')).toHaveValue(record.name);
  await expect(tools.locator('input[name="retentionReviewed"]')).toBeChecked();
  await expect(tools.locator('input[name="artworkReviewed"]')).toBeChecked();
});
