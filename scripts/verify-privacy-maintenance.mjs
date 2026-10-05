import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Execute the real maintenance and private-storage modules with a transactional
// in-memory adapter. Artwork exists only in a uniquely named .tmp fixture.
// No application server, database, network or production storage is used.
const repository = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = path.resolve(repository, ".tmp");
await mkdir(temporaryRoot, { recursive: true });
const fixtureRoot = await mkdtemp(path.join(temporaryRoot, "privacy-maintenance-verification-"));
const storageRoot = path.join(fixtureRoot, "designs");
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
async function sourceModule(relative, imports = {}, suffix = "") {
  const source = await readFile(new URL(`../${relative}`, import.meta.url), "utf8");
  const resolveImport = name => {
    if (name.startsWith("node:")) return name;
    assert.ok(imports[name], `Unreviewed verification import: ${name}`);
    return imports[name];
  };
  return moduleUrl(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText
    .replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => `from ${JSON.stringify(imports[name] ?? resolveImport(name))}`)
    .replace(/import\((["'])([^"']+)\1\)/g, (_match, _quote, name) => `import(${JSON.stringify(resolveImport(name))})`) + suffix);
}
const state = {
  users: new Map(), sessions: [], verifications: [], accounts: [], designs: [], events: [], queries: [], transactions: [],
  failStoragePath: null, failLogArtist: null, failRetention: false, failUserDelete: false,
  withdrawalRace: false, maintenanceGate: null, failDiscovery: false, ticks: [], unrefs: 0, errors: [],
};
const originalEnvironment = Object.fromEntries(["DESIGN_STORAGE_DIR", "PRIVACY_MAINTENANCE_ENABLED", "NEXT_RUNTIME"].map(name => [name, process.env[name]]));
const originalGlobals = Object.fromEntries(["tintaMaintenanceVerification", "tintaPrivacyTimer", "tintaPrivacyRunning", "setInterval"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const originalConsoleError = console.error;
globalThis.tintaMaintenanceVerification = state;
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
async function rejects(work, expected, message) { await assert.rejects(work, expected, message); checks++; }
async function waitMaintenance() {
  const deadline = Date.now() + 5000;
  while (globalThis.tintaPrivacyRunning && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(globalThis.tintaPrivacyRunning, false, "Maintenance must finish without overlapping its next tick");
}
function reset() {
  state.mixedOwnership = false;
  state.users = new Map(); state.sessions = []; state.verifications = []; state.accounts = []; state.designs = [];
  state.events = []; state.queries = []; state.transactions = []; state.errors = [];
  state.failStoragePath = null; state.failLogArtist = null; state.failRetention = false; state.failUserDelete = false;
  state.withdrawalRace = false; state.maintenanceGate = null; state.failDiscovery = false;
}
function user(id, pending = false, overrides = {}) {
  const value = { id, deletionRequestedAt: pending ? new Date("2026-01-01") : null, diagnosticsConsent: false,
    diagnosticsPurgeRequestedAt: null, image: null, ...overrides };
  state.users.set(id, value); return value;
}
async function exists(target) {
  try { await stat(target); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function artwork(key, hoursOld = 0) {
  const target = path.resolve(storageRoot, key);
  assert.ok(target.startsWith(`${storageRoot}${path.sep}`), "Fixture artwork must stay inside isolated storage");
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "isolated artwork fixture");
  const modified = new Date(Date.now() - hoursOld * 3_600_000); await utimes(target, modified, modified);
  return target;
}
const query = (operation, args) => { state.queries.push({ operation, args }); state.events.push(operation); };
function adapter(memory, transactional = false) {
  const lazy = (operation, args, work) => ({ execute() { query(operation, args); return work(); } });
  return {
    $executeRaw: async (strings, ...values) => { state.events.push("lock-artist"); state.queries.push({ operation: "lock-artist", sql: strings.join("?"), values }); },
    $queryRaw: async (strings, ...values) => { state.events.push("lock-user"); state.queries.push({ operation: "lock-user", sql: strings.join("?"), values }); },
    appointment: { findFirst: async args => { query("ownership", args); return memory.mixedOwnership ? { id: "mixed" } : null; } },
    user: {
      findUnique: async args => { query("user.findUnique", args); return memory.users.get(args.where.id) ?? null; },
      findFirst: async args => {
        query("withdrawal.recheck", args);
        const current = memory.users.get(args.where.id);
        if (state.withdrawalRace && current) current.diagnosticsConsent = true;
        return current && !current.diagnosticsConsent && current.diagnosticsPurgeRequestedAt ? { id: current.id } : null;
      },
      findMany: async args => {
        query("user.findMany", args);
        if (state.maintenanceGate) await state.maintenanceGate;
        if (state.failDiscovery) throw new Error("fixture_discovery_failure");
        const pending = args.where.deletionRequestedAt?.not === null;
        return [...memory.users.values()].filter(value => pending ? value.deletionRequestedAt :
          !value.diagnosticsConsent && value.diagnosticsPurgeRequestedAt && !value.deletionRequestedAt)
          .sort((left, right) => (left.deletionRequestedAt?.getTime() ?? 0) - (right.deletionRequestedAt?.getTime() ?? 0))
          .slice(0, args.take).map(({ id }) => ({ id }));
      },
      delete: async args => {
        query("user.delete", args); if (state.failUserDelete) throw new Error("fixture_database_failure");
        memory.users.delete(args.where.id); memory.sessions = memory.sessions.filter(row => row.userId !== args.where.id);
        memory.accounts = memory.accounts.filter(row => row.userId !== args.where.id);
      },
      update: async args => { query("user.update", args); Object.assign(memory.users.get(args.where.id), args.data); },
      updateMany: args => lazy("user.updateMany", args, () => {
        for (const value of memory.users.values()) if (value.image !== null && memory.accounts.some(account => account.userId === value.id && account.providerId === "google")) Object.assign(value, args.data);
      }),
    },
    session: { deleteMany: args => lazy("session.deleteMany", args, () => {
      memory.sessions = memory.sessions.filter(row => !(row.expiresAt < args.where.expiresAt.lt));
    }) },
    verification: { deleteMany: args => {
      const work = () => { memory.verifications = memory.verifications.filter(row => args.where.value !== undefined ? row.value !== args.where.value : !(row.expiresAt < args.where.expiresAt.lt)); };
      return transactional ? Promise.resolve().then(() => { query("verification.deleteMany", args); work(); }) : lazy("verification.deleteMany", args, work);
    } },
    account: { updateMany: args => lazy("account.updateMany", args, () => {
      for (const account of memory.accounts) if (account.providerId === args.where.providerId && args.where.OR.some(condition => account[Object.keys(condition)[0]] != null)) Object.assign(account, args.data);
    }) },
    design: { findMany: async args => {
      query("design.findMany", args);
      const keys = new Set(args.where.OR.flatMap(condition => Object.values(condition)[0].in));
      return memory.designs.filter(record => keys.has(record.storageKey) || keys.has(record.previewKey));
    } },
  };
}
state.prisma = new Proxy({}, { get(_target, name) {
  if (name === "$transaction") return async (work, options) => {
    state.transactions.push(options); const keys = ["users", "sessions", "verifications", "accounts", "designs", "mixedOwnership"];
    const memory = Object.fromEntries(keys.map(key => [key, structuredClone(state[key])]));
    try {
      const result = typeof work === "function" ? await work(adapter(memory, true)) : await Promise.all(work.map(operation => operation.execute()));
      if (typeof work === "function") for (const key of keys) state[key] = memory[key];
      state.events.push("transaction.commit"); return result;
    } catch (error) { state.events.push("transaction.rollback"); throw error; }
  };
  return adapter(state)[name];
} });

try {
  process.env.DESIGN_STORAGE_DIR = storageRoot;
  const filesystemBridge = moduleUrl(`
    export { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
    import { rm as remove } from "node:fs/promises";
    export async function rm(target, options) {
      const state = globalThis.tintaMaintenanceVerification; state.events.push("file.remove:" + target);
      if (target === state.failStoragePath) throw Object.assign(new Error("fixture_storage_unavailable"), { code: "EACCES" });
      return remove(target, options);
    }
  `);
  const storageModule = await sourceModule("src/lib/design-storage.ts", {
    "node:fs/promises": filesystemBridge,
    sharp: import.meta.resolve("sharp"),
  });
  const storage = await import(storageModule);
  const diagnosticsBridge = moduleUrl(`
    const state = globalThis.tintaMaintenanceVerification;
    export async function purgeAccountDiagnostics(id, optionalOnly) {
      state.events.push("diagnostics.purge:" + id + ":" + Boolean(optionalOnly));
      return state.failLogArtist !== id;
    }
    export async function cleanupDiagnostics() { state.events.push("diagnostics.retention"); return !state.failRetention; }
  `);
  const prismaBridge = moduleUrl("export const prisma = globalThis.tintaMaintenanceVerification.prisma;");
  const imports = { "@/lib/prisma": prismaBridge, "@/lib/design-storage": storageModule, "@/lib/diagnostics": diagnosticsBridge };
  const maintenanceModule = await sourceModule("src/lib/privacy-maintenance.ts", imports);
  const maintenance = await import(maintenanceModule);
  console.error = (...args) => state.errors.push(args.join(" "));

  // Direct storage deletion is bounded to one validated artist directory.
  const owned = await artwork("storage-owned/original.png");
  await artwork("storage-owned/nested/abandoned.preview.webp");
  const peer = await artwork("storage-peer/retained.png");
  for (const invalid of ["", ".", "..", "../storage-peer", "storage-owned/../storage-peer", "storage-owned\\..\\storage-peer", storageRoot, "x".repeat(129)]) {
    await rejects(() => storage.removeArtistDesignFiles(invalid), /Invalid artist directory/);
    check(await exists(owned), true); check(await exists(peer), true);
  }
  await storage.removeArtistDesignFiles("storage-owned");
  check(await exists(path.dirname(owned)), false, "Erasure removes nested/abandoned private artwork with its owned folder");
  check(await exists(peer), true, "Erasure preserves another artist's folder");
  await storage.removeArtistDesignFiles("storage-owned"); checks++;
  const outsideTarget = path.join(fixtureRoot, "symlink-target");
  await mkdir(outsideTarget); await writeFile(path.join(outsideTarget, "retain.png"), "retain");
  const link = path.join(storageRoot, "storage-link");
  await symlink(outsideTarget, link, process.platform === "win32" ? "junction" : "dir");
  await storage.removeArtistDesignFiles("storage-link");
  check(await exists(path.join(outsideTarget, "retain.png")), true, "Directory erasure removes a link without following its target");

  // Pending-account erasure is retryable across both filesystem and log outages.
  reset(); user("retry-files", true); user("active-keep");
  const retryFile = await artwork("retry-files/original.png");
  state.failStoragePath = path.join(storageRoot, "retry-files");
  await rejects(() => maintenance.completeAccountErasure("retry-files"), /fixture_storage_unavailable/);
  check(state.users.has("retry-files"), true); check(Boolean(state.users.get("retry-files").deletionRequestedAt), true);
  check(await exists(retryFile), true); check(state.events.some(event => event.startsWith("diagnostics.purge:")), false);
  check(state.events.includes("user.delete"), false); check(state.events.at(-1), "transaction.rollback");
  state.failStoragePath = null; state.failLogArtist = "retry-files"; state.events = [];
  await rejects(() => maintenance.completeAccountErasure("retry-files"), /private_cleanup_unavailable/);
  check(await exists(retryFile), false); check(state.users.has("retry-files"), true);
  check(state.events.includes("user.delete"), false, "Log failure preserves the durable pending account after files are removed");
  state.failLogArtist = null; state.events = [];
  state.verifications = [{ value: "retry-files", expiresAt: new Date(Date.now() + 60_000) }, { value: "active-keep", expiresAt: new Date(Date.now() + 60_000) }];
  check(await maintenance.completeAccountErasure("retry-files"), true);
  check(state.users.has("retry-files"), false); check(state.users.has("active-keep"), true);
  check(state.verifications.map(row => row.value), ["active-keep"]);
  check(state.transactions.at(-1), { isolationLevel: "Serializable", timeout: 30_000 });
  check(state.events.slice(0, 4), ["lock-artist", "lock-user", "user.findUnique", "ownership"]);
  check(state.queries.find(value => value.operation === "lock-artist").values, ["retry-files"]);
  check(state.queries.find(value => value.operation === "lock-user").sql.includes("FOR UPDATE"), true);
  check(state.events.indexOf("user.delete") > state.events.findIndex(event => event === "diagnostics.purge:retry-files:false"), true);
  check(await maintenance.completeAccountErasure("retry-files"), false, "An already-erased user is an idempotent no-op");

  reset(); user("database-retry", true); state.failUserDelete = true;
  state.verifications = [{ value: "database-retry", expiresAt: new Date(Date.now() + 60_000) }];
  await artwork("database-retry/original.png");
  await rejects(() => maintenance.completeAccountErasure("database-retry"), /fixture_database_failure/);
  check(state.users.has("database-retry"), true); check(state.verifications.length, 1, "Database failure rolls back preceding verification deletion");
  state.failUserDelete = false; check(await maintenance.completeAccountErasure("database-retry"), true);

  reset(); user("ownership-stop", true); state.mixedOwnership = true;
  const mixedFile = await artwork("ownership-stop/original.png");
  await rejects(() => maintenance.completeAccountErasure("ownership-stop"), /mixed_ownership/);
  check(await exists(mixedFile), true); check(state.users.has("ownership-stop"), true);
  check(state.events.some(event => event.startsWith("diagnostics.purge:") || event.startsWith("file.remove:")), false);
  const ownershipQuery = state.queries.find(value => value.operation === "ownership").args;
  check(ownershipQuery.select, { id: true }); check(ownershipQuery.where.OR, [
    { artistId: { not: "ownership-stop" }, client: { artistId: "ownership-stop" } },
    { artistId: "ownership-stop", client: { artistId: { not: "ownership-stop" } } },
    { artistId: "ownership-stop", payments: { some: { artistId: { not: "ownership-stop" } } } },
    { artistId: { not: "ownership-stop" }, payments: { some: { artistId: "ownership-stop" } } },
    { artistId: "ownership-stop", designs: { some: { design: { artistId: { not: "ownership-stop" } } } } },
    { artistId: { not: "ownership-stop" }, designs: { some: { design: { artistId: "ownership-stop" } } } },
  ], "The guard checks cross-artist clients, payments and design links in both directions");
  reset(); user("not-pending"); const activeFile = await artwork("not-pending/original.png");
  check(await maintenance.completeAccountErasure("not-pending"), false); check(await exists(activeFile), true);
  check(state.events.includes("ownership"), false); check(state.events.includes("user.delete"), false);

  // Janitor age/ownership retention uses real stat, readdir and rm operations.
  reset();
  const orphanOriginal = await artwork("janitor/orphan.png", 25);
  const orphanPreview = await artwork("janitor/orphan.preview.webp", 25);
  const referencedOriginal = await artwork("janitor/referenced.png", 25);
  const referencedPreview = await artwork("janitor/referenced.preview.webp", 25);
  const fresh = await artwork("janitor/fresh.png", 23.99);
  const invalidFilename = await artwork("janitor/private name.png", 25);
  const invalidDirectory = await artwork("invalid artist/retain.png", 25);
  const nested = await artwork("janitor/nested/retain.png", 25);
  await symlink(outsideTarget, path.join(storageRoot, "janitor-link"), process.platform === "win32" ? "junction" : "dir");
  const candidates = [];
  await storage.pruneUnreferencedDesignFiles(async keys => { candidates.push(...keys); return new Set(["janitor/referenced.png", "janitor/referenced.preview.webp"]); });
  check(await exists(orphanOriginal), false); check(await exists(orphanPreview), false);
  for (const retained of [referencedOriginal, referencedPreview, fresh, invalidFilename, invalidDirectory, nested, path.join(outsideTarget, "retain.png")]) check(await exists(retained), true);
  check(candidates.includes("janitor/fresh.png"), false, "Fresh uploads never enter reference lookup or deletion");
  check(candidates.includes("janitor/nested/retain.png"), false);
  const batches = [];
  for (let index = 0; index < 205; index++) await artwork(`batches/${index}.png`, 25);
  await storage.pruneUnreferencedDesignFiles(async keys => { if (keys[0]?.startsWith("batches/")) batches.push(keys.length); return new Set(keys); });
  check(batches, [100, 100, 5], "Reference lookups remain bounded to 100 keys per batch");

  // A full pass selects pending accounts and narrowly expires dormant records.
  reset(); user("pass-pending", true); user("pass-active", false, { image: "https://old-avatar.example/image" });
  user("pass-local", false, { image: "local-avatar" });
  await artwork("pass-pending/original.png");
  const maintainedOrphan = await artwork("pass-active/unreferenced.png", 25);
  const maintainedOriginal = await artwork("pass-active/kept.png", 25);
  const maintainedPreview = await artwork("pass-active/kept.preview.webp", 25);
  state.designs = [{ storageKey: "pass-active/kept.png", previewKey: "pass-active/kept.preview.webp" }];
  const beforePass = Date.now();
  state.sessions = [{ userId: "pass-active", expiresAt: new Date(beforePass - 60_000) }, { userId: "pass-active", expiresAt: new Date(beforePass + 60_000) }];
  state.verifications = [{ value: "old", expiresAt: new Date(beforePass - 60_000) }, { value: "valid", expiresAt: new Date(beforePass + 60_000) }];
  state.accounts = [{ userId: "pass-active", providerId: "google", accessToken: "old", refreshToken: "old", idToken: "old", scope: "profile", accessTokenExpiresAt: new Date(), refreshTokenExpiresAt: new Date() },
    { userId: "pass-local", providerId: "credential", accessToken: "local-unchanged" }];
  await maintenance.runPrivacyMaintenance();
  check(state.users.has("pass-pending"), false); check(state.users.has("pass-active"), true);
  check(state.sessions.length, 1); check(state.verifications.map(row => row.value), ["valid"]);
  const nullTokens = { accessToken: null, refreshToken: null, idToken: null, scope: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };
  check(state.accounts[0], { userId: "pass-active", providerId: "google", ...nullTokens });
  check(state.accounts[1].accessToken, "local-unchanged");
  check(state.users.get("pass-active").image, null); check(state.users.get("pass-local").image, "local-avatar");
  check(await exists(maintainedOrphan), false); check(await exists(maintainedOriginal), true); check(await exists(maintainedPreview), true);
  const discoveryQueries = state.queries.filter(value => value.operation === "user.findMany");
  check(discoveryQueries[1].args, { where: { deletionRequestedAt: { not: null } }, orderBy: { deletionRequestedAt: "asc" }, take: 10, select: { id: true } });
  const sessionCleanup = state.queries.find(value => value.operation === "session.deleteMany").args;
  const verificationCleanup = state.queries.find(value => value.operation === "verification.deleteMany" && value.args.where.expiresAt).args;
  check(sessionCleanup.where.expiresAt.lt instanceof Date, true); check(sessionCleanup.where.expiresAt.lt.getTime() >= beforePass, true);
  check(verificationCleanup.where.expiresAt.lt.getTime(), sessionCleanup.where.expiresAt.lt.getTime());
  check(state.queries.find(value => value.operation === "account.updateMany").args, { where: { providerId: "google", OR: Object.keys(nullTokens).map(key => ({ [key]: { not: null } })) }, data: nullTokens });
  check(state.queries.find(value => value.operation === "user.updateMany").args, { where: { image: { not: null }, accounts: { some: { providerId: "google" } } }, data: { image: null } });
  const designLookup = state.queries.find(value => value.operation === "design.findMany" && value.args.where.OR[0].storageKey.in.includes("pass-active/kept.png")).args;
  check(designLookup.select, { storageKey: true, previewKey: true });
  check(designLookup.where.OR[0].storageKey.in, designLookup.where.OR[1].previewKey.in, "Both originals and previews are checked against stored references");

  reset(); user("pass-retry", true); user("pass-success", true);
  state.failLogArtist = "pass-retry"; await maintenance.runPrivacyMaintenance();
  check(state.users.has("pass-retry"), true); check(state.users.has("pass-success"), false);
  check(state.events.includes("diagnostics.retention"), true, "One pending erasure failure does not stop retention or other pending users");
  check(state.errors.length, 1); check(state.errors[0].includes("pass-retry"), false, "Retry logging does not expose artist identifiers");
  state.failLogArtist = null; await maintenance.runPrivacyMaintenance(); check(state.users.has("pass-retry"), false);
  reset(); state.failRetention = true;
  await rejects(() => maintenance.runPrivacyMaintenance(), /diagnostic_retention_unavailable/);
  check(state.queries.some(value => value.operation === "design.findMany"), false, "Unavailable diagnostic retention is visible to the scheduler as a retryable failure");

  // Optional diagnostic withdrawal is durable, locked and consent-rechecked.
  reset(); user("withdraw-retry", false, { diagnosticsPurgeRequestedAt: new Date() });
  user("withdraw-consented", false, { diagnosticsConsent: true, diagnosticsPurgeRequestedAt: new Date() });
  user("withdraw-noflag"); user("withdraw-erasing", true, { diagnosticsPurgeRequestedAt: new Date() });
  state.failLogArtist = "withdraw-retry"; await maintenance.runPrivacyMaintenance();
  check(Boolean(state.users.get("withdraw-retry").diagnosticsPurgeRequestedAt), true);
  check(state.events.includes("diagnostics.purge:withdraw-retry:true"), true);
  check(state.events.includes("diagnostics.purge:withdraw-consented:true"), false);
  check(state.events.includes("diagnostics.purge:withdraw-noflag:true"), false);
  check(state.events.includes("diagnostics.purge:withdraw-erasing:true"), false);
  check(state.queries.find(value => value.operation === "user.findMany").args, { where: { diagnosticsConsent: false, diagnosticsPurgeRequestedAt: { not: null }, deletionRequestedAt: null }, take: 10, select: { id: true } });
  state.failLogArtist = null; state.events = []; await maintenance.runPrivacyMaintenance();
  check(state.users.get("withdraw-retry").diagnosticsPurgeRequestedAt, null);
  check(state.events.indexOf("withdrawal.recheck") > state.events.indexOf("lock-user"), true);
  check(state.queries.find(value => value.operation === "withdrawal.recheck").args, { where: { id: "withdraw-retry", diagnosticsConsent: false, diagnosticsPurgeRequestedAt: { not: null } }, select: { id: true } });
  reset(); user("withdraw-race", false, { diagnosticsPurgeRequestedAt: new Date() }); state.withdrawalRace = true;
  await maintenance.runPrivacyMaintenance();
  check(state.events.includes("diagnostics.purge:withdraw-race:true"), false, "A consent change found under the lock stops optional purge");
  check(Boolean(state.users.get("withdraw-race").diagnosticsPurgeRequestedAt), true);

  // No real interval is created: test scheduler/global singleton and runtime gate.
  reset(); delete globalThis.tintaPrivacyTimer; delete globalThis.tintaPrivacyRunning;
  globalThis.setInterval = (callback, milliseconds) => {
    state.ticks.push({ callback, milliseconds }); return { unref() { state.unrefs++; } };
  };
  for (const flag of [undefined, "", "false", "TRUE"]) {
    if (flag === undefined) delete process.env.PRIVACY_MAINTENANCE_ENABLED; else process.env.PRIVACY_MAINTENANCE_ENABLED = flag;
    maintenance.startPrivacyMaintenance(); check(state.ticks.length, 0);
  }
  process.env.PRIVACY_MAINTENANCE_ENABLED = "true";
  let release; state.maintenanceGate = new Promise(resolve => { release = resolve; });
  maintenance.startPrivacyMaintenance();
  check(state.ticks.length, 1); check(state.ticks[0].milliseconds, 15 * 60_000); check(state.unrefs, 1);
  check(globalThis.tintaPrivacyRunning, true); check(state.queries.filter(value => value.operation === "user.findMany").length, 1);
  maintenance.startPrivacyMaintenance();
  const reloaded = await import(await sourceModule("src/lib/privacy-maintenance.ts", imports, "\n// Independent module instance for global singleton verification.\n"));
  reloaded.startPrivacyMaintenance(); check(state.ticks.length, 1, "Hot reload/module instances share one global timer");
  state.ticks[0].callback(); state.ticks[0].callback();
  check(state.queries.filter(value => value.operation === "user.findMany").length, 1, "Timer ticks cannot overlap an unfinished pass");
  state.maintenanceGate = null; release();
  await waitMaintenance(); check(globalThis.tintaPrivacyRunning, false);
  state.failDiscovery = true; state.ticks[0].callback();
  await waitMaintenance(); check(globalThis.tintaPrivacyRunning, false); check(state.errors.at(-1).includes("will retry"), true);
  state.failDiscovery = false; state.ticks[0].callback();
  await waitMaintenance(); check(globalThis.tintaPrivacyRunning, false);
  check(state.events.includes("diagnostics.retention"), true);
  const registerBridge = moduleUrl("export function startPrivacyMaintenance() { globalThis.tintaMaintenanceVerification.registrations++; }");
  const unusedBridge = moduleUrl("export const auth = {}; export const isAllowedStudioEmail = () => false; export const writeDiagnostic = () => {}; export const classifyDiagnosticError = () => 'unknown'; export const defaultDiagnosticContext = () => ({}); export const normalizeDiagnosticPage = () => 'unknown';");
  const { register } = await import(await sourceModule("src/instrumentation.ts", {
    "@/lib/privacy-maintenance": registerBridge, "@/lib/diagnostics": unusedBridge, "@/lib/diagnostic-context": unusedBridge,
    "@/lib/auth": unusedBridge, "@/lib/studio-access": unusedBridge,
  }));
  state.registrations = 0;
  for (const [runtime, enabled] of [["edge", "true"], [undefined, "true"], ["nodejs", "false"], ["nodejs", undefined]]) {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = runtime;
    if (enabled === undefined) delete process.env.PRIVACY_MAINTENANCE_ENABLED; else process.env.PRIVACY_MAINTENANCE_ENABLED = enabled;
    await register(); check(state.registrations, 0);
  }
  process.env.NEXT_RUNTIME = "nodejs"; process.env.PRIVACY_MAINTENANCE_ENABLED = "true";
  await register(); check(state.registrations, 1, "Instrumentation starts maintenance only in explicitly enabled Node runtime");
  console.log(`${checks} privacy maintenance checks passed (transactional mocks, real isolated artwork files and mocked timers).`);
} finally {
  console.error = originalConsoleError;
  for (const [name, value] of Object.entries(originalEnvironment)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  for (const [name, descriptor] of Object.entries(originalGlobals)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  const relative = path.relative(temporaryRoot, path.resolve(fixtureRoot));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Recursive fixture cleanup must remain inside repository .tmp");
  await rm(fixtureRoot, { recursive: true, force: true });
}
