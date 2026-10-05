"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/i18n";
import { isDiagnosticUuid, isDiagnosticWorkspace, type ProblemReport } from "@/lib/diagnostic-context";
import { captureDiagnosticContext, emitDiagnostic, flushDiagnosticEvents, getDiagnosticWorkspace,
  getRecentDiagnosticEvents, setDiagnosticConsent, setDiagnosticWorkspace } from "@/lib/client-diagnostics";
import "./problem-report.css";

const ReportContext = createContext<(() => void) | null>(null);
const copy = {
  es: { title: "Informar de un problema", close: "Cerrar", description: "¿Qué ha pasado?", help: "Cuéntanos qué esperabas y qué ocurrió. No incluyas contraseñas ni datos privados de clientes.",
    context: "Página y hora del problema", send: "Enviar informe", retry: "Reintentar envío", sending: "Enviando…", sent: "Informe recibido", reference: "Referencia", privacy: "Al enviar adjuntamos la página, la hora y el estado de conexión. Si has activado los diagnósticos opcionales, también sus referencias recientes. No copiamos formularios, notas ni imágenes.", privacyLink: "Información de privacidad",
    offline: "Estás sin conexión. Conservamos el informe aquí; podrás enviarlo cuando vuelvas a conectarte.", failed: "No se pudo enviar. Tu texto y la hora original se conservan. Inténtalo de nuevo.", changed: "La cuenta ha cambiado. Revisa el contexto antes de enviar desde la cuenta actual.", review: "Revisar con la cuenta actual", limited: "Has enviado varios informes. Espera unos minutos y vuelve a intentarlo.", thanks: "Gracias. Esta referencia nos permite encontrar el informe y los eventos relacionados.", anonymous: "Sin una sesión activa, no vinculamos el informe a una cuenta. El texto que escribas puede identificarte." },
  en: { title: "Report a problem", close: "Close", description: "What happened?", help: "Tell us what you expected and what happened. Leave out passwords and private client details.",
    context: "Problem page and time", send: "Send report", retry: "Retry sending", sending: "Sending…", sent: "Report received", reference: "Reference", privacy: "When you send, we attach the page, time and connection state. If you enabled optional diagnostics, we also attach their recent references. Forms, notes and images are not copied.", privacyLink: "Privacy information",
    offline: "You’re offline. Your report stays here; send it when you reconnect.", failed: "Could not send. Your text and original time are kept. Please try again.", changed: "The account has changed. Review the context before sending from the current account.", review: "Review with the current account", limited: "You’ve sent several reports. Wait a few minutes and try again.", thanks: "Thank you. This reference lets us find your report and related events.", anonymous: "Without an active session, we do not link the report to an account. The text you enter may identify you." },
};

function pageLabel(report: ProblemReport, es: boolean) {
  const area = report.context.page.split("/")[1];
  const labels: Record<string, string> = es
    ? { calendar: "Agenda", appointments: "Cita", "new-appointment": "Nueva cita", clients: "Clientes", designs: "Diseños", settings: "Ajustes", "sign-in": "Iniciar sesión", "sign-up": "Crear cuenta", "forgot-password": "Recuperar acceso", "reset-password": "Restablecer contraseña" }
    : { calendar: "Calendar", appointments: "Appointment", "new-appointment": "New appointment", clients: "Clients", designs: "Designs", settings: "Settings", "sign-in": "Sign in", "sign-up": "Create account", "forgot-password": "Recover access", "reset-password": "Reset password" };
  const views: Record<string, string> = es ? { day: "Día", week: "Semana", month: "Mes", new: "Nuevo", edit: "Editar", detail: "Detalle" }
    : { day: "Day", week: "Week", month: "Month", new: "New", edit: "Edit", detail: "Detail" };
  return [labels[area] ?? "Tinta", views[report.context.view ?? ""], report.context.calendarAnchor].filter(Boolean).join(" · ");
}

export function ReportProblemButton({ locale, compact = false, fallback = false }: { locale: Locale; compact?: boolean; fallback?: boolean }) {
  const open = useContext(ReportContext);
  if (!open) return null;
  return <button type="button" onClick={open} data-problem-report-trigger={fallback ? "fallback" : "regular"}
    className={`problem-report-trigger${compact ? " problem-report-compact" : ""}${fallback ? " problem-report-fallback" : ""}`} aria-label={copy[locale].title} title={copy[locale].title}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4h16v13H9l-5 4V4Z" /><path d="M12 7v4m0 2v1" /></svg>
    <span>{copy[locale].title}</span>
  </button>;
}

export function ProblemReports({ children, locale }: { children: ReactNode; locale: Locale }) {
  const dictionary = copy[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const reviewWorkspace = useRef<string | null | undefined>(undefined);
  const fallbackWorkspace = useRef<string | null>(null);
  const identityRequest = useRef<AbortController | null>(null);
  const [report, setReport] = useState<ProblemReport | null>(null);
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [identityPending, setIdentityPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<"failed" | "offline" | "changed" | "limited" | null>(null);
  const [fallback, setFallback] = useState(false);

  useLayoutEffect(() => {
    function update() {
      const marker = document.querySelector<HTMLElement>("[data-diagnostic-workspace]");
      if (marker) fallbackWorkspace.current = null;
      setDiagnosticWorkspace(marker ? marker.dataset.diagnosticWorkspace || null : fallbackWorkspace.current);
      const consented = Boolean(marker?.dataset.diagnosticWorkspace && marker.dataset.diagnosticConsent === "true");
      setDiagnosticConsent(consented);
      if (!consented) setReport(current => current?.recentEvents.length ? { ...current, reportId: crypto.randomUUID(), recentEvents: [] } : current);
      setFallback(!document.querySelector('[data-problem-report-trigger="regular"]'));
    }
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-diagnostic-workspace", "data-diagnostic-consent"] });
    return () => { observer.disconnect(); setDiagnosticConsent(false); };
  }, []);

  useEffect(() => {
    const browserError = () => { emitDiagnostic("browser_error", { outcome: "failed", reason: "unknown" }); };
    const rejection = () => { emitDiagnostic("unhandled_rejection", { outcome: "failed", reason: "unknown" }); };
    const reconnect = () => { void flushDiagnosticEvents(); };
    window.addEventListener("error", browserError);
    window.addEventListener("unhandledrejection", rejection);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("error", browserError); window.removeEventListener("unhandledrejection", rejection); window.removeEventListener("online", reconnect);
      request.current?.abort(); identityRequest.current?.abort(); delete document.body.dataset.problemReportOpen;
    };
  }, []);

  function capture(): ProblemReport {
    return { reportId: crypto.randomUUID(), clickedAt: new Date().toISOString(), description: "",
      context: captureDiagnosticContext(), workspaceIdAtClick: getDiagnosticWorkspace(), recentEvents: getRecentDiagnosticEvents() };
  }
  function visible(open: boolean) {
    if (open) document.body.dataset.problemReportOpen = "true";
    else delete document.body.dataset.problemReportOpen;
    window.dispatchEvent(new Event("tinta:report-visibility"));
  }
  function open() {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!report || reference) {
      const snapshot = capture();
      setReport(snapshot); setDescription(""); setReference(null); setError(null); setAttempted(false);
      // A layout failure or404 may render without an account marker. Resolve
      // identity through the existing session endpoint while preserving time.
      if (!document.querySelector("[data-diagnostic-workspace]")) {
        const controller = new AbortController(); identityRequest.current = controller; setIdentityPending(true);
        const timeout = window.setTimeout(() => controller.abort(), 5_000);
        void fetch("/api/workspace/sync", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal })
          .then(async response => {
            if (!response.ok) return;
            const data = await response.json();
            if (!isDiagnosticWorkspace(data?.workspaceId) || data.workspaceId === null) return;
            fallbackWorkspace.current = data.workspaceId; setDiagnosticWorkspace(data.workspaceId);
            setReport(current => current?.reportId === snapshot.reportId ? { ...current, workspaceIdAtClick: data.workspaceId } : current);
          }).catch(() => { /* The report endpoint still verifies any unresolved identity. */ })
          .finally(() => { clearTimeout(timeout); setIdentityPending(false); if (identityRequest.current === controller) identityRequest.current = null; });
      }
    }
    visible(true);
    dialog.current?.showModal();
  }
  function close() {
    request.current?.abort(); identityRequest.current?.abort(); dialog.current?.close(); visible(false); trigger.current?.focus();
  }
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report || inFlight.current || identityPending || !description.trim()) return;
    if (!navigator.onLine) { setError("offline"); return; }
    inFlight.current = true; setPending(true); setError(null); setAttempted(true);
    const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/reports", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...report, description }), signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (response.ok && isDiagnosticUuid(body?.reference)) setReference(body.reference);
      else {
        if (response.status === 409 && body?.error === "account_changed" && isDiagnosticWorkspace(body.currentWorkspaceId)) reviewWorkspace.current = body.currentWorkspaceId;
        setError(response.status === 409 && body?.error === "account_changed" ? "changed" : response.status === 429 ? "limited" : "failed");
      }
    } catch { setError(navigator.onLine ? "failed" : "offline"); }
    finally { clearTimeout(timer); inFlight.current = false; setPending(false); if (request.current === controller) request.current = null; }
  }

  return <ReportContext.Provider value={open}>
    {children}
    {fallback ? <ReportProblemButton locale={locale} fallback /> : null}
    <dialog ref={dialog} className="problem-report-dialog" aria-labelledby="problem-report-title" onCancel={event => { event.preventDefault(); close(); }} onClose={() => { visible(false); trigger.current?.focus(); }}>
      <div className="problem-report-heading"><p className="eyebrow">TINTA</p><button type="button" className="problem-report-close" onClick={close} aria-label={dictionary.close}>×</button></div>
      <h2 id="problem-report-title">{reference ? dictionary.sent : dictionary.title}</h2>
      {reference ? <div role="status"><p>{dictionary.thanks}</p><p className="field-help">{dictionary.reference}</p><code className="problem-report-reference">{reference}</code><div className="form-actions"><button type="button" className="primary-button" onClick={close}>{dictionary.close}</button></div></div>
        : <form onSubmit={send} aria-busy={pending}>
          {report ? <div className="problem-report-context"><span className="field-help">{dictionary.context}</span><strong>{pageLabel(report, locale === "es")}</strong><time dateTime={report.clickedAt}>{new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: report.context.timezone }).format(new Date(report.clickedAt))} · {report.context.timezone}</time></div> : null}
          <div className="field"><label htmlFor="problem-description">{dictionary.description}</label><textarea id="problem-description" autoFocus rows={4} maxLength={2000} required value={description} disabled={pending} aria-describedby="problem-report-help" onChange={event => {
            if (attempted && report) { setReport({ ...report, reportId: crypto.randomUUID() }); setAttempted(false); }
            setDescription(event.target.value);
          }} /><p id="problem-report-help" className="field-help">{dictionary.help}</p></div>
          <p className="problem-report-privacy">{dictionary.privacy}</p>
          <p className="field-help"><a href={`/privacy?lang=${locale}`} target="_blank" rel="noopener noreferrer">{dictionary.privacyLink}</a></p>
          {report?.workspaceIdAtClick === null ? <p className="field-help">{dictionary.anonymous}</p> : null}
          {error ? <p role="alert" className="form-error">{dictionary[error]}</p> : null}
          <div className="form-actions">{error === "changed" ? <button type="button" className="primary-button" onClick={event => { event.preventDefault(); if (reviewWorkspace.current !== undefined) { fallbackWorkspace.current = reviewWorkspace.current; setDiagnosticWorkspace(reviewWorkspace.current); } setReport(capture()); setError(null); setAttempted(false); }}>{dictionary.review}</button>
            : <button className="primary-button" type="submit" disabled={pending || identityPending || !description.trim()}>{pending ? dictionary.sending : attempted ? dictionary.retry : dictionary.send}</button>}<button type="button" className="secondary-button" onClick={close}>{dictionary.close}</button></div>
        </form>}
    </dialog>
  </ReportContext.Provider>;
}
