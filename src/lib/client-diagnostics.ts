"use client";

import {
  CLIENT_DIAGNOSTIC_CODES, DIAGNOSTIC_OUTCOMES, DIAGNOSTIC_REASONS, DIAGNOSTIC_SYNC_STATES,
  normalizeDiagnosticPage, parseSafeDiagnosticEvent, validDiagnosticTimezone,
  type DiagnosticCode, type DiagnosticContext, type SafeDiagnosticEvent,
} from "@/lib/diagnostic-context";

export type DiagnosticMetadata = Pick<SafeDiagnosticEvent, "outcome" | "digest" | "status" | "reason">;
type QueuedEvent = { event: SafeDiagnosticEvent; workspaceIdAtClick: string | null };
const limit = 20;
let workspace: string | null | undefined;
let consent = false;
let recent: SafeDiagnosticEvent[] = [];
let queue: QueuedEvent[] = [];
let sending = false;
let activeRequest: AbortController | null = null;

/** Rendered workspace identity is a precondition only. The server determines the actor. */
export function setDiagnosticWorkspace(next: string | null) {
  if (workspace === next) return;
  setDiagnosticConsent(false);
  workspace = next;
}

export function getDiagnosticWorkspace() { return workspace ?? null; }

/** Optional collection starts only after the rendered account has consented. */
export function setDiagnosticConsent(enabled: boolean) {
  consent = enabled === true && typeof workspace === "string" && workspace.length > 0;
  if (!consent) {
    activeRequest?.abort();
    recent = [];
    queue = [];
  }
}

export function captureDiagnosticContext(): DiagnosticContext {
  const page = normalizeDiagnosticPage(window.location.pathname);
  let view: DiagnosticContext["view"] = null;
  if (page === "/calendar") {
    const candidate = new URLSearchParams(window.location.search).get("view");
    view = candidate === "day" || candidate === "month" ? candidate : "week";
  } else if (page.endsWith("/edit")) view = "edit";
  else if (page.endsWith("/new") || page === "/new-appointment") view = "new";
  else if (page.endsWith("/:id")) view = "detail";
  else if (page === "/clients" || page === "/designs") view = "list";
  else if (page === "/settings") view = "settings";
  else if (["/sign-in", "/sign-up", "/forgot-password", "/reset-password"].includes(page)) view = "auth";
  const sync = document.querySelector<HTMLElement>(".workspace-sync-status")?.dataset.state;
  let timezone = "UTC";
  try {
    const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (validDiagnosticTimezone(candidate)) timezone = candidate;
  } catch { /* UTC remains safe if the browser cannot resolve its timezone. */ }
  const anchor = page === "/calendar" ? new URLSearchParams(window.location.search).get("anchor") : null;
  const calendarAnchor = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor)
    && Number.isFinite(Date.parse(`${anchor}T00:00:00.000Z`))
    && new Date(`${anchor}T00:00:00.000Z`).toISOString().slice(0, 10) === anchor ? anchor : null;
  return {
    page, view, timezone, online: navigator.onLine,
    calendarAnchor,
    deviceCategory: window.innerWidth < 600 ? "phone" : window.innerWidth < 1000 ? "tablet" : "desktop",
    syncState: DIAGNOSTIC_SYNC_STATES.includes(sync as DiagnosticContext["syncState"])
      ? sync as DiagnosticContext["syncState"] : "unknown",
  };
}

export function getRecentDiagnosticEvents(): SafeDiagnosticEvent[] {
  if (!consent) return [];
  return recent.map(event => ({ ...event, context: { ...event.context } }));
}

/** Best effort metadata delivery. Failures stay in memory and never interrupt the artist. */
export async function flushDiagnosticEvents() {
  if (!consent || !workspace || sending || typeof window === "undefined" || !navigator.onLine) return;
  sending = true;
  try {
    while (consent && workspace && queue.length && navigator.onLine) {
      const item = queue[0];
      if (item.workspaceIdAtClick !== workspace) { queue.shift(); continue; }
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch("/api/diagnostics", {
          method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ ...item.event, workspaceIdAtClick: item.workspaceIdAtClick }),
        });
        if (queue[0] !== item) continue;
        if ([401, 403, 409].includes(response.status)) { setDiagnosticConsent(false); break; }
        if (response.ok || response.status === 400) queue.shift();
        else break;
      } catch { break; }
      finally {
        window.clearTimeout(timeout);
        if (activeRequest === controller) activeRequest = null;
      }
    }
  } finally { sending = false; }
}

/** Never pass an Error, message, stack, URL, field value or business record here. */
export function emitDiagnostic(code: DiagnosticCode, metadata: DiagnosticMetadata = {}): string | null {
  // Do not read page, browser or connection context before this consent gate.
  if (!consent || !workspace || typeof window === "undefined" || !CLIENT_DIAGNOSTIC_CODES.includes(code) || !window.crypto?.randomUUID) return null;
  const safe = parseSafeDiagnosticEvent({
    id: crypto.randomUUID(), occurredAt: new Date().toISOString(), code, context: captureDiagnosticContext(),
    ...(DIAGNOSTIC_OUTCOMES.includes(metadata.outcome as NonNullable<DiagnosticMetadata["outcome"]>) ? { outcome: metadata.outcome } : {}),
    ...(typeof metadata.digest === "string" && /^\d{1,32}$/.test(metadata.digest) ? { digest: metadata.digest } : {}),
    ...(Number.isInteger(metadata.status) && metadata.status! >= 400 && metadata.status! <= 599 ? { status: metadata.status } : {}),
    ...(DIAGNOSTIC_REASONS.includes(metadata.reason as NonNullable<DiagnosticMetadata["reason"]>) ? { reason: metadata.reason } : {}),
  }, true);
  if (!safe) return null;
  const previous = recent.at(-1);
  if (previous && previous.code === safe.code && JSON.stringify(previous.context) === JSON.stringify(safe.context)
    && previous.reason === safe.reason && previous.outcome === safe.outcome && previous.digest === safe.digest
    && previous.status === safe.status && Date.now() - Date.parse(previous.occurredAt) < 10_000) return previous.id;
  recent = [...recent.slice(-(limit - 1)), safe];
  if (workspace !== undefined) {
    queue = [...queue.slice(-(limit - 1)), { event: safe, workspaceIdAtClick: workspace }];
    void flushDiagnosticEvents();
  }
  return safe.id;
}
