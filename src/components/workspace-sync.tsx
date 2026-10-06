"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import { useClearWorkspace } from "@/components/workspace-access";
import type { Locale } from "@/i18n";
import { emitDiagnostic, setDiagnosticConsent } from "@/lib/client-diagnostics";
import { clearAppointmentDrafts } from "@/lib/appointment-draft";
import "./workspace-sync.css";

type SyncStatus = "current" | "pending" | "offline" | "error" | "refreshing";
const interval = 3_000;

function formSnapshot(form: HTMLFormElement) {
  return JSON.stringify(Array.from(form.elements).flatMap<unknown>((element, index) => {
    if (element instanceof HTMLInputElement) {
      if (["hidden", "submit", "button", "reset"].includes(element.type)) return [];
      if (element.type === "file") return [[index, element.name, Array.from(element.files ?? []).map(file => [file.name, file.size, file.lastModified])]];
      return [[index, element.name, element.value, element.checked]];
    }
    if (element instanceof HTMLTextAreaElement) return [[index, element.name, element.value]];
    if (element instanceof HTMLSelectElement) return [[index, element.name, Array.from(element.selectedOptions).map(option => option.value)]];
    return [];
  }));
}

export function WorkspaceSync({ workspaceId, revision, locale }: { workspaceId: string; revision: string; locale: Locale }) {
  const router = useRouter();
  const clearWorkspace = useClearWorkspace();
  const pathname = usePathname();
  const params = useSearchParams();
  const route = `${pathname}?${params}`;
  const [status, setStatus] = useState<SyncStatus>("current");
  const [confirming, setConfirming] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const appliedRevision = useRef(revision);
  const observedRevision = useRef(revision);
  const refreshTarget = useRef<string | null>(null);
  const refreshStarted = useRef(0);
  const transitionSeen = useRef(false);
  const transitionPending = useRef(false);
  const reconcileRef = useRef<(() => void) | null>(null);
  const lastField = useRef<HTMLElement | null>(null);
  const initialRefresh = useRef(true);
  const [loadStalled, setLoadStalled] = useState(false);

  useEffect(() => {
    transitionPending.current = isRefreshing;
    if (refreshTarget.current !== null && isRefreshing) transitionSeen.current = true;
    if (refreshTarget.current !== null && transitionSeen.current && !isRefreshing
      && BigInt(revision) >= BigInt(refreshTarget.current)) {
      // Acknowledge only the version observed BEFORE requesting fresh data.
      // A later commit during rendering must still trigger another refresh.
      appliedRevision.current = refreshTarget.current;
      refreshTarget.current = null;
      transitionSeen.current = false;
    }
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) reconcileRef.current?.(); });
    return () => { cancelled = true; };
  }, [revision, isRefreshing]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshWatchdog: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failed = false;
    let retryDelay = interval;
    let firstCheck = initialRefresh.current && !/(?:\/(?:new|edit)|^\/new-appointment)$/.test(route.split("?")[0]);
    let checked = false;
    let reportedProblem: "error" | "offline" | null = null;
    const baselines = new WeakMap<HTMLFormElement, string>();

    function protectedDraft() {
      if (document.body.dataset.problemReportOpen === "true") return true;
      const groups = Array.from(document.querySelectorAll<HTMLElement>("#main-content [data-sync-protect]"))
        .filter(group => group.getClientRects().length > 0);
      for (const group of groups) {
        if (group.dataset.syncPending === "true" || group.dataset.syncDirty === "true") return true;
        if (!(group instanceof HTMLFormElement)) continue;
        const form = group;
        const snapshot = formSnapshot(form);
        if (!baselines.has(form)) baselines.set(form, snapshot);
        if (form.dataset.syncPending === "true") return true;
        if (form.dataset.syncDirty === "true") return true;
        if (form.dataset.syncDirty !== "false" && snapshot !== baselines.get(form)) return true;
        const field = document.activeElement;
        if (field instanceof HTMLElement && field.matches("input,textarea,select,[contenteditable=true]") && form.contains(field)) return true;
      }
      return false;
    }

    function show(next: SyncStatus) {
      if (!active) return;
      if ((next === "error" || next === "offline") && next !== reportedProblem) {
        emitDiagnostic(next === "offline" ? "sync_offline" : "sync_failed", {
          outcome: "failed", reason: next === "offline" ? "offline" : "response",
        });
        reportedProblem = next;
      } else if (next === "current" && reportedProblem) {
        emitDiagnostic("sync_recovered", { outcome: "recovered" });
        reportedProblem = null;
      }
      setStatus(current => current === next ? current : next);
    }

    function reconcile() {
      if (!active) return;
      if (!navigator.onLine) { show("offline"); return; }
      if (refreshTarget.current !== null) {
        if (Date.now() - refreshStarted.current > 15_000) {
          // Keep the target until the original response settles. A healthy
          // revision poll must not hide a stalled page refresh.
          setLoadStalled(true);
          show("error");
          return;
        } else { show("refreshing"); return; }
      }
      setLoadStalled(current => current ? false : current);
      if (failed) { show("error"); return; }
      if (!checked) return;
      if (transitionPending.current) { show("refreshing"); return; }
      const changed = observedRevision.current !== appliedRevision.current;
      if (changed || firstCheck) {
        if (protectedDraft()) { show(changed ? "pending" : "current"); return; }
        firstCheck = false;
        initialRefresh.current = false;
        refreshTarget.current = observedRevision.current;
        refreshStarted.current = Date.now();
        transitionSeen.current = false;
        show("refreshing");
        startTransition(() => router.refresh());
        clearTimeout(refreshWatchdog);
        refreshWatchdog = setTimeout(reconcile, 15_100);
        return;
      }
      show("current");
    }
    reconcileRef.current = reconcile;

    function schedule(delay = retryDelay) {
      clearTimeout(timer);
      if (active && document.visibilityState === "visible") timer = setTimeout(() => void check(), delay);
    }

    function leaveWorkspace(path: "/sign-in" | "/calendar") {
      // Remove every private view, including profile and drafts, before waiting
      // for document navigation. Draft protection applies only to this artist.
      clearAppointmentDrafts();
      flushSync(clearWorkspace);
      window.location.replace(path);
    }

    async function check() {
      clearTimeout(timer);
      if (!active || controller || document.visibilityState !== "visible") return;
      if (!navigator.onLine) { show("offline"); return; }
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort("timeout"), 8_000);
      try {
        const response = await fetch("/api/workspace/sync", {
          credentials: "same-origin", cache: "no-store", redirect: "error",
          headers: { Accept: "application/json" }, signal: request.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          emitDiagnostic("sync_session_expired", { outcome: "failed", status: response.status, reason: "unauthorized" });
          leaveWorkspace("/sign-in");
          return;
        }
        if (!response.ok) throw new Error("Workspace refresh unavailable.");
        const body: unknown = await response.json();
        if (!active) return;
        if (!body || typeof body !== "object" || !("workspaceId" in body)
          || typeof body.workspaceId !== "string" || !body.workspaceId || body.workspaceId.length > 128) {
          throw new Error("Workspace identity response invalid.");
        }
        if (body.workspaceId !== workspaceId) {
          // Different artists can have equal revision values. Account changes
          // must clear the previous view even when it contains unsaved edits.
          leaveWorkspace("/calendar");
          return;
        }
        if (!("revision" in body)
          || typeof body.revision !== "string" || !/^(0|[1-9]\d{0,18})$/.test(body.revision)) {
          throw new Error("Workspace refresh response invalid.");
        }
        // Withdrawal takes effect even while an unsaved business form delays
        // the normal page refresh. Enabling still requires rendered consent.
        if ("diagnosticsConsent" in body && body.diagnosticsConsent === false) {
          const marker = document.querySelector<HTMLElement>("[data-diagnostic-workspace]");
          if (marker?.dataset.diagnosticWorkspace === workspaceId) marker.dataset.diagnosticConsent = "false";
          setDiagnosticConsent(false);
        }
        observedRevision.current = body.revision;
        checked = true;
        failed = false;
        retryDelay = interval;
        reconcile();
      } catch {
        if (active && (!request.signal.aborted || request.signal.reason === "timeout")) {
          failed = true;
          retryDelay = Math.min(retryDelay * 2, 30_000);
          show(navigator.onLine ? "error" : "offline");
        }
      } finally {
        clearTimeout(timeout);
        if (controller === request) controller = null;
        // Hiding a tab or losing connectivity is expected cancellation, not a
        // failed sync. Check immediately if it became visible again meanwhile.
        schedule(request.signal.reason === "hidden" && navigator.onLine ? 0 : retryDelay);
      }
    }

    function catchUp() {
      if (document.visibilityState !== "visible") {
        clearTimeout(timer);
        controller?.abort("hidden");
        return;
      }
      retryDelay = interval;
      void check();
    }
    function offline() {
      clearTimeout(timer);
      controller?.abort("offline");
      show("offline");
    }
    function restored(event: PageTransitionEvent) {
      if (event.persisted) catchUp();
    }
    function formChanged(event: Event) {
      if (event.target instanceof HTMLElement && event.target.closest("[data-sync-protect]")) {
        if (event.type === "focusin" && event.target.matches("input,textarea,select")) lastField.current = event.target;
        queueMicrotask(reconcile);
      }
    }
    // Explicit form dirty flags also cover token insertion, restored booking
    // drafts and successful saves that normalize values without an input event.
    const observer = new MutationObserver(() => queueMicrotask(reconcile));
    const main = document.getElementById("main-content");
    if (main) {
      protectedDraft();
      observer.observe(main, { subtree: true, childList: true, attributes: true,
        attributeFilter: ["data-sync-dirty", "data-sync-pending", "value", "checked", "disabled"] });
    }
    document.addEventListener("input", formChanged, true);
    document.addEventListener("change", formChanged, true);
    document.addEventListener("focusin", formChanged, true);
    document.addEventListener("focusout", formChanged, true);
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);
    window.addEventListener("offline", offline);
    window.addEventListener("pageshow", restored);
    window.addEventListener("tinta:report-visibility", reconcile);
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(refreshWatchdog);
      controller?.abort("unmounted");
      observer.disconnect();
      reconcileRef.current = null;
      refreshTarget.current = null;
      transitionSeen.current = false;
      document.removeEventListener("input", formChanged, true);
      document.removeEventListener("change", formChanged, true);
      document.removeEventListener("focusin", formChanged, true);
      document.removeEventListener("focusout", formChanged, true);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("tinta:report-visibility", reconcile);
    };
  }, [router, route, startTransition, workspaceId, clearWorkspace]);

  const es = locale === "es";
  const message = status === "pending"
    ? (es ? "Hay cambios de otro dispositivo. Tus cambios sin guardar se conservan." : "Changes from another device are ready. Your unsaved edits are kept.")
    : status === "offline"
      ? (es ? "Sin conexión. Actualizaremos los cambios cuando vuelvas a conectarte." : "Offline. Updates will resume when you reconnect.")
      : status === "error"
        ? loadStalled
          ? (es ? "La actualización está tardando demasiado. Tus cambios sin guardar se conservan." : "Loading updates is taking too long. Your unsaved edits are kept.")
          : (es ? "No se pudieron actualizar los cambios. Lo intentaremos de nuevo." : "Updates could not be checked. Retrying automatically.")
        : "";
  return <div className="workspace-sync-status" data-state={status} role="status" aria-live="polite" hidden={!message}>
    <p>{message}</p>
    {status === "pending" || loadStalled ? confirming ? <div className="workspace-sync-actions">
      <span>{es ? "¿Descartar lo que no has guardado y cargar la última versión?" : "Discard unsaved edits and load the latest version?"}</span>
      <button type="button" className="text-link" onClick={() => window.location.reload()}>{es ? "Descartar y actualizar" : "Discard and reload"}</button>
      <button type="button" className="text-link" onClick={() => { setConfirming(false); lastField.current?.focus(); }}>{es ? "Seguir editando" : "Keep editing"}</button>
    </div> : <button type="button" className="text-link" onClick={() => setConfirming(true)}>{es ? "Revisar cambios" : "Review updates"}</button> : null}
  </div>;
}
