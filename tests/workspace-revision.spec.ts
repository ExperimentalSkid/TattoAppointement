import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { expect, test } from "./fixtures";

let prisma: typeof import("../src/lib/prisma").prisma;
let getWorkspaceRevision: typeof import("../src/lib/workspace-sync").getWorkspaceRevision;

function disposableDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
    throw new Error("Workspace revision tests require an explicitly authorized disposable _e2e database.");
  }
  return url.href;
}

async function owner() {
  return prisma.user.create({ data: { name: "Tattoo artist", email: "revision-owner@example.com" } });
}

async function revision(artistId: string) {
  return BigInt(await getWorkspaceRevision(artistId));
}

async function expectChange(artistId: string, mutate: () => Promise<unknown>) {
  const before = await revision(artistId);
  await mutate();
  expect(await revision(artistId)).toBeGreaterThan(before);
}

async function appointmentFixtures(artistId: string) {
  const client = await prisma.client.create({ data: { artistId, name: "Artwork client", phone: "+34600000001" } });
  const design = await prisma.design.create({ data: { artistId, title: "Tattoo artwork", storageKey: `${randomUUID()}.webp` } });
  const appointment = await prisma.appointment.create({
    data: { artistId, clientId: client.id, startsAt: new Date("2026-10-05T10:00:00.000Z"), durationMinutes: 60 },
  });
  return { client, design, appointment };
}

test.beforeAll(async () => {
  disposableDatabaseUrl();
  ({ prisma } = await import("../src/lib/prisma"));
  ({ getWorkspaceRevision } = await import("../src/lib/workspace-sync"));
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

test("migration seeds an existing artist without changing saved tattoo records", async () => {
  const pool = new Pool({ connectionString: disposableDatabaseUrl() });
  const connection = await pool.connect();
  // All replayed migration objects live inside this disposable schema. The
  // normal test schema and the studio preview databases are never migrated here.
  const schema = `revision_migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await connection.query(`CREATE SCHEMA "${schema}"`);
    await connection.query(`SET search_path TO "${schema}"`);
    const directory = path.resolve("prisma/migrations");
    const migrations = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const syncIndex = migrations.indexOf("20261003180000_workspace_revision");
    expect(syncIndex).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, syncIndex)) {
      await connection.query(await readFile(path.join(directory, migration, "migration.sql"), "utf8"));
    }
    await connection.query('INSERT INTO "user" ("id", "name", "email", "studioName", "updatedAt") VALUES ($1, $2, $3, $4, NOW())',
      ["existing-artist", "Existing artist", "existing@example.com", "Existing tattoo studio"]);
    await connection.query('INSERT INTO "Client" ("id", "artistId", "name", "phone", "updatedAt") VALUES ($1, $2, $3, $4, NOW())',
      ["existing-client", "existing-artist", "Saved client", "+34600000002"]);

    await connection.query(await readFile(path.join(directory, migrations[syncIndex], "migration.sql"), "utf8"));
    const seeded = await connection.query('SELECT "revision" FROM "WorkspaceRevision" WHERE "artistId" = $1', ["existing-artist"]);
    expect(seeded.rows).toEqual([{ revision: "0" }]);
    const saved = await connection.query('SELECT "name", "phone" FROM "Client" WHERE "id" = $1', ["existing-client"]);
    expect(saved.rows).toEqual([{ name: "Saved client", phone: "+34600000002" }]);
    await connection.query('UPDATE "Client" SET "name" = $1 WHERE "id" = $2', ["Updated saved client", "existing-client"]);
    expect((await connection.query('SELECT "revision" FROM "WorkspaceRevision"')).rows).toEqual([{ revision: "1" }]);
  } finally {
    await connection.query("ROLLBACK");
    await connection.query("SET search_path TO public");
    await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    connection.release();
    await pool.end();
  }
});

test("new artists receive a durable baseline and revisions retain BigInt precision", async () => {
  const artist = await owner();
  expect(await getWorkspaceRevision(artist.id)).toBe("0");
  await prisma.workspaceRevision.update({ where: { artistId: artist.id }, data: { revision: 9007199254740993n } });
  await prisma.client.create({ data: { artistId: artist.id, name: "Precision client", phone: "+34600000003" } });
  expect(await getWorkspaceRevision(artist.id)).toBe("9007199254740994");
});

test("client, design, appointment and payment create, edit and delete all invalidate the workspace", async () => {
  const artist = await owner();
  let client!: Awaited<ReturnType<typeof prisma.client.create>>;
  let design!: Awaited<ReturnType<typeof prisma.design.create>>;
  let appointment!: Awaited<ReturnType<typeof prisma.appointment.create>>;
  let payment!: Awaited<ReturnType<typeof prisma.payment.create>>;
  await expectChange(artist.id, async () => { client = await prisma.client.create({ data: { artistId: artist.id, name: "Client", phone: "+34600000004" } }); });
  await expectChange(artist.id, () => prisma.client.update({ where: { id: client.id }, data: { notes: "Placement preference" } }));
  await expectChange(artist.id, async () => { design = await prisma.design.create({ data: { artistId: artist.id, title: "Design", storageKey: `${randomUUID()}.webp` } }); });
  await expectChange(artist.id, () => prisma.design.update({ where: { id: design.id }, data: { title: "Revised design" } }));
  await expectChange(artist.id, async () => { appointment = await prisma.appointment.create({ data: { artistId: artist.id, clientId: client.id, startsAt: new Date("2026-10-06T09:00:00.000Z"), durationMinutes: 60 } }); });
  await expectChange(artist.id, () => prisma.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } }));
  await expectChange(artist.id, async () => { payment = await prisma.payment.create({ data: { artistId: artist.id, appointmentId: appointment.id, amount: "30.00" } }); });
  await expectChange(artist.id, () => prisma.payment.update({ where: { id: payment.id }, data: { amount: "35.00" } }));
  await expectChange(artist.id, () => prisma.payment.delete({ where: { id: payment.id } }));
  await expectChange(artist.id, () => prisma.appointment.delete({ where: { id: appointment.id } }));
  await expectChange(artist.id, () => prisma.design.delete({ where: { id: design.id } }));
  await expectChange(artist.id, () => prisma.client.delete({ where: { id: client.id } }));
});

test("artwork associations, final flags and cascading removals invalidate the workspace", async () => {
  const artist = await owner();
  const { design, appointment } = await appointmentFixtures(artist.id);
  const key = { appointmentId: appointment.id, designId: design.id };
  await expectChange(artist.id, () => prisma.appointmentDesign.create({ data: key }));
  await expectChange(artist.id, () => prisma.appointmentDesign.update({ where: { appointmentId_designId: key }, data: { isFinal: true } }));
  const beforeNoOp = await revision(artist.id);
  await prisma.appointmentDesign.update({ where: { appointmentId_designId: key }, data: { isFinal: true } });
  expect(await revision(artist.id)).toBe(beforeNoOp);
  await expectChange(artist.id, () => prisma.appointmentDesign.delete({ where: { appointmentId_designId: key } }));
  await prisma.appointmentDesign.create({ data: key });
  await expectChange(artist.id, () => prisma.design.delete({ where: { id: design.id } }));
  expect(await prisma.appointmentDesign.count()).toBe(0);
  const otherDesign = await prisma.design.create({ data: { artistId: artist.id, title: "Other design", storageKey: `${randomUUID()}.webp` } });
  await prisma.appointmentDesign.create({ data: { appointmentId: appointment.id, designId: otherDesign.id } });
  await expectChange(artist.id, () => prisma.appointment.delete({ where: { id: appointment.id } }));
  expect(await prisma.appointmentDesign.count()).toBe(0);
});

test("actual profile changes sync while no-op updates and authentication metadata do not", async () => {
  const artist = await owner();
  const profileChanges = [
    { name: "New artist name" },
    { studioName: "Chosen tattoo studio" },
    { whatsappReminderTemplate: "Hello {clientName}, your tattoo is on {date}." },
    { language: "en" },
  ];
  for (const data of profileChanges) {
    const before = await revision(artist.id);
    await prisma.user.update({ where: { id: artist.id }, data });
    expect(await revision(artist.id)).toBe(before + 1n);
  }
  const beforeMetadata = await revision(artist.id);
  await prisma.user.update({ where: { id: artist.id }, data: Object.assign({}, ...profileChanges) });
  await prisma.user.update({ where: { id: artist.id }, data: { emailVerified: true, image: "https://example.com/avatar.webp" } });
  await prisma.session.create({ data: { userId: artist.id, token: randomUUID(), expiresAt: new Date("2027-01-01T00:00:00.000Z") } });
  await prisma.account.create({ data: { userId: artist.id, accountId: artist.id, providerId: "credential", password: "test-metadata-only" } });
  expect(await revision(artist.id)).toBe(beforeMetadata);
});

test("Google connection membership syncs while token and password metadata stay quiet", async () => {
  const artist = await owner();
  const credential = await prisma.account.create({
    data: { userId: artist.id, accountId: artist.id, providerId: "credential", password: "test-metadata-only" },
  });
  const before = await revision(artist.id);
  const google = await prisma.account.create({
    data: { userId: artist.id, accountId: "test-google-subject", providerId: "google" },
  });
  expect(await revision(artist.id)).toBe(before + 1n);
  await prisma.account.update({
    where: { id: google.id },
    data: { accessToken: "test-local-token", refreshToken: "test-local-refresh", idToken: "test-local-id", scope: "openid email profile" },
  });
  await prisma.account.update({ where: { id: credential.id }, data: { password: "test-changed-password-metadata" } });
  expect(await revision(artist.id)).toBe(before + 1n);

  await prisma.account.update({ where: { id: google.id }, data: { providerId: "credential" } });
  expect(await revision(artist.id)).toBe(before + 2n);
  await prisma.account.update({ where: { id: google.id }, data: { providerId: "google" } });
  expect(await revision(artist.id)).toBe(before + 3n);
  await prisma.account.delete({ where: { id: google.id } });
  expect(await revision(artist.id)).toBe(before + 4n);
  await prisma.account.delete({ where: { id: credential.id } });
  expect(await revision(artist.id)).toBe(before + 4n);
});

test("uncommitted and rolled-back mutations never publish a workspace revision", async () => {
  const artist = await owner();
  const client = await prisma.client.create({ data: { artistId: artist.id, name: "Original client", phone: "+34600000005" } });
  const before = await revision(artist.id);
  await expect(prisma.$transaction(async (transaction) => {
    await transaction.client.update({ where: { id: client.id }, data: { name: "Uncommitted client" } });
    await transaction.design.create({ data: { artistId: artist.id, title: "Uncommitted artwork", storageKey: `${randomUUID()}.webp` } });
    expect((await transaction.workspaceRevision.findUniqueOrThrow({ where: { artistId: artist.id } })).revision).toBeGreaterThan(before);
    // A second connection can only see committed state during the transaction.
    expect(await revision(artist.id)).toBe(before);
    throw new Error("Deliberate test rollback");
  })).rejects.toThrow("Deliberate test rollback");
  expect(await revision(artist.id)).toBe(before);
  expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).name).toBe("Original client");
  expect(await prisma.design.count()).toBe(0);
});

test("simultaneous independent committed mutations preserve every revision increment", async () => {
  const artist = await owner();
  const before = await revision(artist.id);
  const count = 12;
  await Promise.all(Array.from({ length: count }, (_, index) => prisma.client.create({
    data: { artistId: artist.id, name: `Concurrent client ${index}`, phone: `+346000001${String(index).padStart(2, "0")}` },
  })));
  expect(await prisma.client.count({ where: { artistId: artist.id } })).toBe(count);
  expect(await revision(artist.id)).toBe(before + BigInt(count));
});

test("deleting the artist removes its revision without recreating it during child cascades", async () => {
  const artist = await owner();
  await prisma.account.create({ data: { userId: artist.id, accountId: "cascade-google-subject", providerId: "google" } });
  const { design, appointment } = await appointmentFixtures(artist.id);
  await prisma.appointmentDesign.create({ data: { appointmentId: appointment.id, designId: design.id, isFinal: true } });
  await prisma.payment.create({ data: { artistId: artist.id, appointmentId: appointment.id, amount: "25.00" } });
  // Existing Client -> Appointment Restrict requires appointment cleanup before
  // deleting the owner; the remaining client/design cascades still run triggers.
  await prisma.appointment.delete({ where: { id: appointment.id } });
  await prisma.user.delete({ where: { id: artist.id } });
  expect(await prisma.workspaceRevision.count()).toBe(0);
  expect(await prisma.account.count()).toBe(0);
  expect(await prisma.client.count()).toBe(0);
  expect(await prisma.design.count()).toBe(0);
  expect(await prisma.appointmentDesign.count()).toBe(0);
  expect(await prisma.payment.count()).toBe(0);
});
