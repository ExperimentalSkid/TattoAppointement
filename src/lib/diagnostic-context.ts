export const DIAGNOSTIC_CODES = [
  "auth_sign_in_success", "auth_sign_in_failed", "appointment_create_failed", "appointment_create_saved",
  "appointment_update_failed", "appointment_update_saved", "appointment_reschedule_failed", "appointment_reschedule_saved",
  "appointment_cancelled", "design_upload_failed", "design_upload_saved", "server_error", "page_error", "browser_error",
  "unhandled_rejection", "action_failed", "sync_failed", "sync_recovered", "sync_offline", "sync_session_expired",
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];
export const CLIENT_DIAGNOSTIC_CODES: readonly DiagnosticCode[] = ["auth_sign_in_failed", "page_error", "browser_error",
  "unhandled_rejection", "action_failed", "sync_failed", "sync_recovered", "sync_offline", "sync_session_expired"];
export const DIAGNOSTIC_PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/calendar",
  "/new-appointment", "/clients", "/clients/new", "/clients/:id", "/clients/:id/edit", "/designs", "/designs/new",
  "/designs/:id", "/designs/:id/edit", "/appointments/:id", "/appointments/:id/edit", "/settings", "/join", "/admin", "/admin/artists", "/admin/reports", "/unknown"] as const;
export type DiagnosticPage = typeof DIAGNOSTIC_PAGES[number];
export const DIAGNOSTIC_VIEWS = ["day", "week", "month", "list", "detail", "new", "edit", "settings", "auth"] as const;
export type DiagnosticView = typeof DIAGNOSTIC_VIEWS[number] | null;
export const DIAGNOSTIC_DEVICES = ["phone", "tablet", "desktop", "unknown"] as const;
export const DIAGNOSTIC_SYNC_STATES = ["current", "pending", "offline", "error", "refreshing", "unknown"] as const;
export const DIAGNOSTIC_OUTCOMES = ["failed", "saved", "recovered", "pending"] as const;
export const DIAGNOSTIC_REASONS = ["network", "timeout", "unauthorized", "forbidden", "validation", "save", "unknown", "offline", "conflict", "response"] as const;
export type DiagnosticContext = {
  page: DiagnosticPage;
  view: DiagnosticView;
  timezone: string;
  deviceCategory: typeof DIAGNOSTIC_DEVICES[number];
  syncState: typeof DIAGNOSTIC_SYNC_STATES[number];
  online: boolean;
  calendarAnchor?: string | null;
};
export type SafeDiagnosticEvent = {
  id: string;
  occurredAt: string;
  code: DiagnosticCode;
  context: DiagnosticContext;
  outcome?: typeof DIAGNOSTIC_OUTCOMES[number];
  digest?: string;
  status?: number;
  reason?: typeof DIAGNOSTIC_REASONS[number];
};
export type ProblemReport = {
  reportId: string;
  clickedAt: string;
  description: string;
  context: DiagnosticContext;
  workspaceIdAtClick: string | null;
  recentEvents: SafeDiagnosticEvent[];
};

// Only route patterns survive. Never retain a query, host, record ID or fragment.
export function normalizeDiagnosticPage(input: string): DiagnosticPage {
  const pathname = input.split(/[?#]/, 1)[0];
  if ((DIAGNOSTIC_PAGES as readonly string[]).includes(pathname)) return pathname as DiagnosticPage;
  if (/^\/(clients|designs|appointments)\/[^/]+\/edit\/?$/.test(pathname)) {
    return `/${pathname.split("/")[1]}/:id/edit` as DiagnosticPage;
  }
  if (/^\/(clients|designs|appointments)\/[^/]+\/?$/.test(pathname)) {
    return `/${pathname.split("/")[1]}/:id` as DiagnosticPage;
  }
  return "/unknown";
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}
function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
export function isDiagnosticUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isDiagnosticTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function isDiagnosticWorkspace(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value));
}
export function validDiagnosticTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80 || !/^[A-Za-z0-9_+/-]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
export function parseDiagnosticContext(value: unknown): DiagnosticContext | null {
  if (!object(value) || !exactKeys(value, ["page", "view", "timezone", "deviceCategory", "syncState", "online", "calendarAnchor"])
    || !includes(DIAGNOSTIC_PAGES, value.page) || !(value.view === null || includes(DIAGNOSTIC_VIEWS, value.view))
    || !validDiagnosticTimezone(value.timezone) || !includes(DIAGNOSTIC_DEVICES, value.deviceCategory)
    || !includes(DIAGNOSTIC_SYNC_STATES, value.syncState) || typeof value.online !== "boolean") return null;
  const anchor = value.calendarAnchor ?? null;
  if (anchor !== null && (value.page !== "/calendar" || typeof anchor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)
    || !Number.isFinite(Date.parse(`${anchor}T00:00:00.000Z`))
    || new Date(`${anchor}T00:00:00.000Z`).toISOString().slice(0, 10) !== anchor)) return null;
  return { page: value.page, view: value.view, timezone: value.timezone, deviceCategory: value.deviceCategory,
    syncState: value.syncState, online: value.online, calendarAnchor: anchor as string | null };
}
export function parseSafeDiagnosticEvent(value: unknown, clientOnly = false): SafeDiagnosticEvent | null {
  if (!object(value) || !exactKeys(value, ["id", "occurredAt", "code", "context", "outcome", "digest", "status", "reason"])
    || !isDiagnosticUuid(value.id) || !isDiagnosticTimestamp(value.occurredAt)
    || !includes(DIAGNOSTIC_CODES, value.code) || (clientOnly && !CLIENT_DIAGNOSTIC_CODES.includes(value.code))) return null;
  const context = parseDiagnosticContext(value.context);
  if (!context || (value.outcome !== undefined && !includes(DIAGNOSTIC_OUTCOMES, value.outcome))
    || (value.digest !== undefined && (typeof value.digest !== "string" || !/^\d{1,32}$/.test(value.digest)))
    || (value.status !== undefined && (typeof value.status !== "number" || !Number.isInteger(value.status) || value.status < 400 || value.status > 599))
    || (value.reason !== undefined && !includes(DIAGNOSTIC_REASONS, value.reason))) return null;
  return { id: value.id.toLowerCase(), occurredAt: value.occurredAt, code: value.code, context,
    ...(value.outcome !== undefined ? { outcome: value.outcome as SafeDiagnosticEvent["outcome"] } : {}),
    ...(value.digest !== undefined ? { digest: value.digest as string } : {}),
    ...(value.status !== undefined ? { status: value.status as number } : {}),
    ...(value.reason !== undefined ? { reason: value.reason as SafeDiagnosticEvent["reason"] } : {}) };
}
export function parseDiagnosticIntake(value: unknown): { event: SafeDiagnosticEvent; workspaceIdAtClick: string | null } | null {
  if (!object(value) || !isDiagnosticWorkspace(value.workspaceIdAtClick)) return null;
  const { workspaceIdAtClick, ...eventFields } = value;
  const event = parseSafeDiagnosticEvent(eventFields, true);
  return event ? { event, workspaceIdAtClick } : null;
}
export function parseProblemReport(value: unknown): ProblemReport | null {
  if (!object(value) || !exactKeys(value, ["reportId", "clickedAt", "description", "context", "workspaceIdAtClick", "recentEvents"])
    || !isDiagnosticUuid(value.reportId) || !isDiagnosticTimestamp(value.clickedAt)
    || !isDiagnosticWorkspace(value.workspaceIdAtClick) || typeof value.description !== "string"
    || !value.description.trim() || value.description.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.description)
    || !Array.isArray(value.recentEvents) || value.recentEvents.length > 20) return null;
  const context = parseDiagnosticContext(value.context);
  const recentEvents = value.recentEvents.map(event => parseSafeDiagnosticEvent(event, true));
  if (!context || recentEvents.some(event => !event)) return null;
  return { reportId: value.reportId.toLowerCase(), clickedAt: value.clickedAt, description: value.description.trim(), context,
    workspaceIdAtClick: value.workspaceIdAtClick, recentEvents: recentEvents as SafeDiagnosticEvent[] };
}
export function defaultDiagnosticContext(code?: DiagnosticCode): DiagnosticContext {
  const page = code?.startsWith("auth_") ? "/sign-in" : code?.startsWith("appointment_") ? "/appointments/:id"
    : code?.startsWith("design_") ? "/designs" : "/unknown";
  return { page, view: null, timezone: "UTC", deviceCategory: "unknown", syncState: "unknown", online: true };
}
