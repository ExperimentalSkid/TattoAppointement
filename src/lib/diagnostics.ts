import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultDiagnosticContext, isDiagnosticWorkspace, isDiagnosticTimestamp, isDiagnosticUuid, parseProblemReport, parseSafeDiagnosticEvent,
  type DiagnosticCode, type DiagnosticContext, type ProblemReport, type SafeDiagnosticEvent,
} from "./diagnostic-context";

const DAY = 86_400_000;
export const DIAGNOSTICS_RETENTION_DAYS = 30;
export const MAX_DIAGNOSTIC_DAILY_BYTES = 10 * 1024 * 1024;
export const MAX_REPORT_DAILY_BYTES = 5 * 1024 * 1024;
export const MAX_REPORTS_PER_DAY = 1000;
const MAX_PENDING_WRITES = 64;
const LOG_TIMEOUT_MS = 500;
const REPORT_TIMEOUT_MS = 5000;
type ErrorKind = "database_unique" | "database_missing" | "database_connection" | "storage_io" | "timeout" | "unknown";
const errorKinds: readonly ErrorKind[] = ["database_unique", "database_missing", "database_connection", "storage_io", "timeout", "unknown"];
export type DiagnosticInput = Partial<Omit<SafeDiagnosticEvent, "code" | "context">> & {
  code: DiagnosticCode; context?: DiagnosticContext; artistId?: string | null; errorKind?: ErrorKind;
};
type DiagnosticRecord = SafeDiagnosticEvent & {
  receivedAt: string; artistId: string | null; source: "client" | "server"; appVersion: string; errorKind?: ErrorKind;
};
type ReportRecord = Omit<ProblemReport, "workspaceIdAtClick"> & {
  reference: string; receivedAt: string; artistId: string | null; source: "artist_report";
  appVersion: string; idempotencyKey: string; fingerprint: string;
};
export type ReportSaveResult = { ok: true; reference: string } | { ok: false; error: "conflict" | "unavailable" };
export type AdminReportRecord = {
  id: string; artistId: string | null; createdAt: string; clickedAt: string;
  message: string; route: DiagnosticContext["page"]; pageview: DiagnosticContext["view"];
  deviceCategory: DiagnosticContext["deviceCategory"]; calendarAnchor: string | null; appVersion: string;
};
type StoreOptions = { directory: string; maxDiagnosticBytes?: number; maxReportBytes?: number; now?: () => Date };

export function classifyDiagnosticError(error: unknown): ErrorKind {
  if (!error || typeof error !== "object") return "unknown";
  try {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    const name = "name" in error && typeof error.name === "string" ? error.name : undefined;
    if (code === "P2002") return "database_unique";
    if (code === "P2025") return "database_missing";
    if (code && ["P1000", "P1001", "P1002", "P1008", "P1017", "P2024", "ECONNREFUSED", "ECONNRESET"].includes(code)) return "database_connection";
    if (code && ["EACCES", "EPERM", "ENOENT", "ENOSPC", "EIO", "EROFS", "EDQUOT"].includes(code)) return "storage_io";
    if (code === "ETIMEDOUT" || name === "TimeoutError") return "timeout";
  } catch { /* Error classification must not interrupt the original action. */ }
  return "unknown";
}
export function diagnosticAppVersion() {
  const release = process.env.TINTA_RELEASE;
  return release && /^[A-Za-z0-9._-]{1,80}$/.test(release) ? release : "0.1.0";
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function timeIsRecent(timestamp: string, now: Date) {
  const difference = now.getTime() - Date.parse(timestamp);
  return difference >= -5 * 60_000 && difference < DIAGNOSTICS_RETENTION_DAYS * DAY;
}
export function diagnosticTimeIsRecent(timestamp: string) { return timeIsRecent(timestamp, new Date()); }

// One writer per Node process. The deployed app has one instance/private disk.
// A global store also serializes calls from separately bundled route modules.
export function createDiagnosticStore(options: StoreOptions) {
  const directory = path.resolve(/* turbopackIgnore: true */ options.directory);
  const maxDiagnosticBytes = Math.min(options.maxDiagnosticBytes ?? MAX_DIAGNOSTIC_DAILY_BYTES, MAX_DIAGNOSTIC_DAILY_BYTES);
  const maxReportBytes = Math.min(options.maxReportBytes ?? MAX_REPORT_DAILY_BYTES, MAX_REPORT_DAILY_BYTES);
  const now = options.now ?? (() => new Date());
  let queue = Promise.resolve();
  let pending = 0;
  let indexDay = "";
  const reportIndex = new Map<string, { reference: string; fingerprint: string }>();
  const reportCounts = new Map<string, number>();

  async function accountErased(artistId: string | null, date: Date) {
    if (!artistId) return false;
    try {
      const marker = JSON.parse(await readFile(path.join(directory, `.erased-${hash(artistId)}.json`), "utf8"));
      return Date.parse(marker.expiresAt) > date.getTime();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
      // A malformed deletion marker must not allow data to reappear.
      return true;
    }
  }

  function enqueue<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    if (pending >= MAX_PENDING_WRITES) return Promise.resolve(fallback);
    pending++;
    const result = queue.then(operation).catch(() => fallback);
    queue = result.then(() => { pending--; });
    return result;
  }
  async function prepare(date: Date) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const today = date.toISOString().slice(0, 10);
    if (indexDay === today) return;
    const cutoff = new Date(date.getTime() - (DIAGNOSTICS_RETENTION_DAYS - 1) * DAY).toISOString().slice(0, 10);
    reportIndex.clear();
    reportCounts.clear();
    const files = await readdir(directory);
    for (const file of files) {
      if (/^\.erased-[a-f0-9]{64}\.json$/.test(file)) {
        const markerPath = path.join(directory, file);
        const marker = JSON.parse(await readFile(markerPath, "utf8"));
        if (Number.isFinite(Date.parse(marker.expiresAt)) && Date.parse(marker.expiresAt) <= date.getTime()) await unlink(markerPath);
        continue;
      }
      const match = /^(diagnostics|reports)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
      if (!match) continue;
      const filePath = path.join(/* turbopackIgnore: true */ directory, file);
      if (match[2] < cutoff) { await unlink(filePath); continue; }
      if (match[2] > today || match[1] !== "reports") continue;
      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size > MAX_REPORT_DAILY_BYTES) throw new Error("invalid_private_log");
      await chmod(filePath, 0o600);
      const text = await readFile(filePath, "utf8");
      // A partial write is a storage problem. Do not acknowledge or overwrite it.
      if (text && !text.endsWith("\n")) throw new Error("incomplete_private_log");
      let count = 0;
      for (const line of text.split("\n")) {
        if (!line) continue;
        const row = JSON.parse(line) as Partial<ReportRecord>;
        if (typeof row.idempotencyKey !== "string" || !/^[a-f0-9]{64}$/.test(row.idempotencyKey)
          || typeof row.reference !== "string" || typeof row.fingerprint !== "string") throw new Error("invalid_private_log");
        reportIndex.set(row.idempotencyKey, { reference: row.reference, fingerprint: row.fingerprint });
        count++;
        if (count > MAX_REPORTS_PER_DAY) throw new Error("private_log_limit");
      }
      reportCounts.set(match[2], count);
    }
    indexDay = today;
  }
  async function append(kind: "diagnostics" | "reports", value: unknown, date: Date, maxBytes: number) {
    const filePath = path.join(/* turbopackIgnore: true */ directory, `${kind}-${date.toISOString().slice(0, 10)}.jsonl`);
    const line = `${JSON.stringify(value)}\n`;
    const file = await open(filePath, "a+", 0o600);
    try {
      const { size } = await file.stat();
      if (size + Buffer.byteLength(line, "utf8") > maxBytes) return false;
      if (size) {
        const tail = Buffer.alloc(1);
        await file.read(tail, 0, 1, size - 1);
        if (tail[0] !== 10) throw new Error("incomplete_private_log");
      }
      await file.chmod(0o600);
      await file.writeFile(line, "utf8");
      return true;
    } finally { await file.close(); }
  }
  function writeEvent(input: DiagnosticInput, source: "client" | "server" = "server"): Promise<boolean> {
    return enqueue(async () => {
      const date = now();
      const event = parseSafeDiagnosticEvent({
        id: input.id ?? randomUUID(), occurredAt: input.occurredAt ?? date.toISOString(), code: input.code,
        context: input.context ?? defaultDiagnosticContext(input.code),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(input.digest !== undefined ? { digest: input.digest } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      }, source === "client");
      const artistId = input.artistId ?? null;
      if (!event || !isDiagnosticWorkspace(artistId) || !timeIsRecent(event.occurredAt, date)) return false;
      await prepare(date);
      if (await accountErased(artistId, date)) return false;
      const record: DiagnosticRecord = { ...event, receivedAt: date.toISOString(), artistId, source, appVersion: diagnosticAppVersion(),
        ...(source === "server" && input.errorKind && errorKinds.includes(input.errorKind) ? { errorKind: input.errorKind } : {}) };
      return append("diagnostics", record, date, maxDiagnosticBytes);
    }, false);
  }
  function saveReport(report: ProblemReport, artistId: string | null): Promise<ReportSaveResult> {
    return enqueue<ReportSaveResult>(async () => {
      const date = now();
      if (!isDiagnosticWorkspace(artistId) || !timeIsRecent(report.clickedAt, date)) return { ok: false, error: "unavailable" };
      await prepare(date);
      if (await accountErased(artistId, date)) return { ok: false, error: "unavailable" };
      const { workspaceIdAtClick: _expectedWorkspace, ...contents } = report;
      void _expectedWorkspace;
      const idempotencyKey = hash(JSON.stringify([artistId, report.reportId]));
      const fingerprint = hash(JSON.stringify(contents));
      const previous = reportIndex.get(idempotencyKey);
      if (previous) return previous.fingerprint === fingerprint ? { ok: true, reference: previous.reference } : { ok: false, error: "conflict" };
      const day = date.toISOString().slice(0, 10);
      if ((reportCounts.get(day) ?? 0) >= MAX_REPORTS_PER_DAY) return { ok: false, error: "unavailable" };
      const reference = randomUUID();
      const record: ReportRecord = { ...contents, reference, receivedAt: date.toISOString(), artistId,
        source: "artist_report", appVersion: diagnosticAppVersion(), idempotencyKey, fingerprint };
      if (!await append("reports", record, date, maxReportBytes)) return { ok: false, error: "unavailable" };
      reportIndex.set(idempotencyKey, { reference, fingerprint });
      reportCounts.set(day, (reportCounts.get(day) ?? 0) + 1);
      return { ok: true, reference };
    }, { ok: false, error: "unavailable" });
  }
  async function privateRows(file: string) {
    const filename = path.join(directory, file);
    const metadata = await stat(filename);
    const bound = file.startsWith("reports-") ? MAX_REPORT_DAILY_BYTES : MAX_DIAGNOSTIC_DAILY_BYTES;
    if (!metadata.isFile() || metadata.size > bound) throw new Error("invalid_private_log");
    const contents = await readFile(filename, "utf8");
    if (contents && !contents.endsWith("\n")) throw new Error("incomplete_private_log");
    return contents.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  }
  async function replaceRows(file: string, rows: Record<string, unknown>[]) {
    const temporary = path.join(directory, `.privacy-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, rows.map(row => `${JSON.stringify(row)}\n`).join(""), { flag: "wx", mode: 0o600 });
      await rename(temporary, path.join(directory, file));
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async function logFiles() { return (await readdir(directory)).filter(file => /^(diagnostics|reports)-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort(); }
  function exportAccount(artistId: string) {
    return enqueue(async () => {
      if (!isDiagnosticWorkspace(artistId) || !artistId) throw new Error("invalid_account");
      await prepare(now());
      const diagnostics: Record<string, unknown>[] = [], reports: Record<string, unknown>[] = [];
      for (const file of await logFiles()) {
        for (const row of await privateRows(file)) {
          if (row.artistId !== artistId) continue;
          const { idempotencyKey: _key, fingerprint: _fingerprint, ...personalData } = row;
          void _key; void _fingerprint;
          (file.startsWith("reports-") ? reports : diagnostics).push(personalData);
        }
      }
      return { diagnostics, reports };
    }, null);
  }
  function purgeAccount(artistId: string, optionalOnly = false) {
    return enqueue(async () => {
      if (!isDiagnosticWorkspace(artistId) || !artistId) return false;
      await prepare(now());
      if (!optionalOnly) await writeFile(path.join(directory, `.erased-${hash(artistId)}.json`), JSON.stringify({ expiresAt: new Date(now().getTime() + DIAGNOSTICS_RETENTION_DAYS * DAY).toISOString() }), { mode: 0o600 });
      for (const file of await logFiles()) {
        if (optionalOnly && !file.startsWith("diagnostics-")) continue;
        const rows = await privateRows(file);
        const retained = rows.filter(row => row.artistId !== artistId || (optionalOnly && row.source !== "client"));
        if (retained.length !== rows.length) await replaceRows(file, retained);
      }
      indexDay = "";
      await prepare(now());
      return true;
    }, false);
  }
  // Share the writer's queue with erasure: a panel read cannot race a purge or
  // expose internal deduplication hashes. Only explicitly submitted reports are read.
  function readAdminReports() {
    return enqueue<AdminReportRecord[] | null>(async () => {
      const date = now();
      await prepare(date);
      const reports: AdminReportRecord[] = [];
      const today = date.toISOString().slice(0, 10);
      for (const file of (await logFiles()).filter(file => file.startsWith("reports-") && file.slice(8, 18) <= today).reverse()) {
        for (const row of await privateRows(file)) {
          if (row.source !== "artist_report" || !isDiagnosticUuid(row.reference) || !isDiagnosticTimestamp(row.receivedAt)
            || !isDiagnosticWorkspace(row.artistId) || typeof row.appVersion !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(row.appVersion)) {
            throw new Error("invalid_private_report");
          }
          if (!timeIsRecent(row.receivedAt, date)) continue;
          const report = parseProblemReport({ reportId: row.reportId, clickedAt: row.clickedAt, description: row.description,
            context: row.context, recentEvents: row.recentEvents, workspaceIdAtClick: null });
          if (!report) throw new Error("invalid_private_report");
          reports.push({ id: row.reference, artistId: row.artistId, createdAt: row.receivedAt, clickedAt: report.clickedAt,
            message: report.description, route: report.context.page, pageview: report.context.view,
            deviceCategory: report.context.deviceCategory, calendarAnchor: report.context.calendarAnchor ?? null,
            appVersion: row.appVersion });
        }
        // Files are chronological, so older files cannot enter the latest fifty.
        reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        reports.length = Math.min(reports.length, 50);
        if (reports.length === 50) break;
      }
      return reports;
    }, null);
  }
  function cleanup() {
    return enqueue(async () => { indexDay = ""; await prepare(now()); return true; }, false);
  }
  return { writeEvent, saveReport, exportAccount, purgeAccount, readAdminReports, cleanup };
}

type DiagnosticStore = ReturnType<typeof createDiagnosticStore>;
const globalState = globalThis as typeof globalThis & { tintaDiagnosticStores?: Map<string, DiagnosticStore> };
function store() {
  const directory = path.resolve(/* turbopackIgnore: true */ process.env.DIAGNOSTICS_DIR ?? path.join(process.cwd(), ".data", "diagnostics"));
  const stores = globalState.tintaDiagnosticStores ??= new Map();
  if (!stores.has(directory)) stores.set(directory, createDiagnosticStore({ directory }));
  return stores.get(directory)!;
}
async function bounded<T>(work: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export async function writeDiagnostic(input: DiagnosticInput): Promise<boolean> {
  try { return await bounded(store().writeEvent(input), LOG_TIMEOUT_MS, false); } catch { return false; }
}
export async function writeClientDiagnostic(event: SafeDiagnosticEvent, artistId: string | null): Promise<boolean> {
  try { return await bounded(store().writeEvent({ ...event, artistId }, "client"), LOG_TIMEOUT_MS, false); } catch { return false; }
}
export async function saveProblemReport(report: ProblemReport, artistId: string | null): Promise<ReportSaveResult> {
  try { return await bounded(store().saveReport(report, artistId), REPORT_TIMEOUT_MS, { ok: false, error: "unavailable" }); }
  catch { return { ok: false, error: "unavailable" }; }
}

export async function exportAccountDiagnostics(artistId: string) { return store().exportAccount(artistId); }
export async function purgeAccountDiagnostics(artistId: string, optionalOnly = false) { return store().purgeAccount(artistId, optionalOnly); }
export async function cleanupDiagnostics() { return store().cleanup(); }
export async function readAdminProblemReports() {
  return bounded<AdminReportRecord[] | null>(store().readAdminReports(), REPORT_TIMEOUT_MS, null);
}

export class DiagnosticBodyError extends Error {
  constructor(readonly code: "invalid_body" | "too_large") { super(code); }
}
export async function readDiagnosticBody(request: Request, maxBytes: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || !request.body) throw new DiagnosticBodyError("invalid_body");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new DiagnosticBodyError("too_large");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new DiagnosticBodyError("too_large"); }
      parts.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new DiagnosticBodyError("invalid_body"); }
}
export function diagnosticSameOrigin(request: Request) {
  try {
    const expected = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    return request.headers.get("origin") === expected && request.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}
type RateBucket = { until: number; count: number };
const rateState = globalThis as typeof globalThis & { tintaDiagnosticRates?: { secret: Buffer; buckets: Map<string, RateBucket> } };
// Transient HMAC keys only; no raw IP, header, token or user agent enters a log.
export function consumeDiagnosticRate(request: Request, kind: "diagnostics" | "reports", artistId?: string | null) {
  const state = rateState.tintaDiagnosticRates ??= { secret: randomBytes(32), buckets: new Map() };
  const now = Date.now();
  for (const [key, bucket] of state.buckets) if (bucket.until <= now) state.buckets.delete(key);
  const individualLimit = kind === "reports" ? 10 : 60;
  const globalLimit = kind === "reports" ? 300 : 3000;
  const raw = artistId ? `artist:${artistId}` : `network:${(request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown").slice(0, 128).split(",", 1)[0].trim()}`;
  const fingerprint = createHmac("sha256", state.secret).update(raw).digest("hex");
  const keys = artistId ? [[`${kind}:${fingerprint}`, individualLimit] as const]
    : [[`${kind}:global`, globalLimit] as const, [`${kind}:${fingerprint}`, individualLimit] as const];
  if (state.buckets.size > 4096) return false;
  if (keys.some(([key, limit]) => (state.buckets.get(key)?.count ?? 0) >= limit)) return false;
  for (const [key] of keys) {
    const bucket = state.buckets.get(key) ?? { until: now + 10 * 60_000, count: 0 };
    bucket.count++;
    state.buckets.set(key, bucket);
  }
  return true;
}
