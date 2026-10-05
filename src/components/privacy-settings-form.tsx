"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/i18n";
import { getDiagnosticWorkspace, setDiagnosticConsent } from "@/lib/client-diagnostics";

const copy = {
  es: {
    label: "Permitir diagnósticos opcionales del navegador", save: "Guardar preferencia", saving: "Guardando…", retry: "Reintentar", saved: "Preferencia guardada.",
    purpose: "Están desactivados por defecto. Si los activas, enviamos referencias de errores y acciones, página, hora, conexión, zona horaria, vista de agenda y categoría de dispositivo vinculadas a tu cuenta para investigar fallos. No incluyen texto de formularios ni imágenes.",
    choice: "Es opcional: puedes seguir usando Tinta y enviar informes manuales sin activarlos. Puedes retirarlos aquí en cualquier momento.",
    withdrawal: "Al retirarlos detenemos la recogida y solicitamos la eliminación de los eventos opcionales guardados. Los informes que envíes y los registros necesarios del servicio se gestionan por separado.",
    incomplete: "La información legal del operador está incompleta. No se pueden activar hasta que esté disponible.", info: "Información de privacidad y conservación", failed: "No se pudo confirmar el cambio. Reintenta guardarlo.",
    withdrawFailed: "Los diagnósticos están detenidos en esta página, pero no se pudo confirmar el cambio en tu cuenta. Reintenta guardarlo.", cleanup: "La preferencia está desactivada, pero falta completar la eliminación de eventos guardados. Reintenta aquí.",
    changed: "La cuenta ha cambiado. Abre Ajustes con la cuenta actual antes de guardar.", signin: "La sesión ha terminado. Inicia sesión de nuevo para guardar la preferencia.",
  },
  en: {
    label: "Allow optional browser diagnostics", save: "Save preference", saving: "Saving…", retry: "Retry", saved: "Preference saved.",
    purpose: "These are off by default. If enabled, we send error and action references, page, time, connection, time zone, calendar view and device category linked to your account to investigate failures. They do not include form text or images.",
    choice: "This is optional: you can use Tinta and send manual reports without enabling it. You can withdraw here at any time.",
    withdrawal: "Withdrawal stops collection and requests deletion of stored optional events. Reports you send and necessary service logs are handled separately.",
    incomplete: "The operator’s legal information is incomplete. Enabling is unavailable until that information is provided.", info: "Privacy and retention information", failed: "Could not confirm the change. Please try saving again.",
    withdrawFailed: "Diagnostics have stopped on this page, but the change to your account could not be confirmed. Please try saving again.", cleanup: "The preference is off, but deletion of stored events still needs to finish. Please retry here.",
    changed: "The account has changed. Open Settings with the current account before saving.", signin: "Your session has ended. Sign in again to save your preference.",
  },
};
type PreferenceError = "failed" | "withdrawFailed" | "cleanup" | "changed" | "signin" | "incomplete";

function applyBrowserPreference(enabled: boolean, actor: string | null) {
  const marker = document.querySelector<HTMLElement>("[data-diagnostic-workspace]");
  if (!actor || marker?.dataset.diagnosticWorkspace !== actor || getDiagnosticWorkspace() !== actor) return false;
  // Keep the observer in agreement with the explicit choice while React updates.
  marker.dataset.diagnosticConsent = String(enabled);
  setDiagnosticConsent(enabled);
  return true;
}

export function PrivacySettingsForm({ locale, enabled, configured }: { locale: Locale; enabled: boolean; configured: boolean }) {
  const dictionary = copy[locale];
  const router = useRouter();
  const [selected, setSelected] = useState(enabled);
  const [saved, setSaved] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<PreferenceError | null>(null);
  const [lastEnabled, setLastEnabled] = useState(enabled);
  const [deferredEnabled, setDeferredEnabled] = useState<boolean | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  // Accept a changed server preference once this form has no local draft. A
  // response to our own save must not be reset by still-rendered older props.
  if (enabled !== lastEnabled) {
    setLastEnabled(enabled);
    if (!pending && selected === saved && !error) {
      setSelected(enabled); setSaved(enabled); setSuccess(false); setDeferredEnabled(null);
    } else setDeferredEnabled(enabled);
  } else if (deferredEnabled !== null && !pending && selected === saved && !error) {
    setSelected(deferredEnabled); setSaved(deferredEnabled); setSuccess(false); setDeferredEnabled(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || (selected && !configured)) return;
    const actor = getDiagnosticWorkspace();
    if (!selected) applyBrowserPreference(false, actor);
    setSuccess(false); setError(null);
    if (!navigator.onLine) { setError(selected ? "failed" : "withdrawFailed"); return; }
    const controller = new AbortController(); request.current = controller; setPending(true);
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/preferences/diagnostics", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: selected }), signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (response.status === 401) { setError("signin"); return; }
      if (response.status === 409 && body?.error === "privacy_not_configured") { setError("incomplete"); return; }
      if (body?.workspaceId && (body.workspaceId !== actor || getDiagnosticWorkspace() !== actor)) { setError("changed"); return; }
      const cleanupPending = response.status === 503 && body?.error === "cleanup_unavailable" && body.enabled === false;
      if ((response.ok || cleanupPending)
        && typeof body?.enabled === "boolean" && (body.enabled === selected || cleanupPending) && body.workspaceId === actor
        && applyBrowserPreference(body.enabled, actor)) {
        setSaved(body.enabled);
        setError(response.ok ? null : "cleanup");
        setSuccess(response.ok);
        router.refresh();
      } else setError(selected ? "failed" : "withdrawFailed");
    } catch { if (!controller.signal.aborted || request.current === controller) setError(selected ? "failed" : "withdrawFailed"); }
    finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; setPending(false); } }
  }

  return <form className="settings-form privacy-settings-form" onSubmit={save} aria-busy={pending}
    data-sync-protect data-sync-dirty={selected !== saved || Boolean(error)} data-sync-pending={pending}>
    <p className="muted-copy">{dictionary.purpose}</p>
    <p className="muted-copy">{dictionary.choice}</p>
    <label className="privacy-choice" htmlFor="optional-diagnostics">
      <input id="optional-diagnostics" type="checkbox" checked={selected} disabled={pending || (!configured && !saved)}
        onChange={event => { if (!event.target.checked || configured) { setSelected(event.target.checked); setSuccess(false); setError(null); } }} />
      <span>{dictionary.label}</span>
    </label>
    <p className="field-help">{dictionary.withdrawal}</p>
    {!configured ? <p className="field-help">{dictionary.incomplete}</p> : null}
    <p><a className="text-link" href={`/privacy?lang=${locale}`}>{dictionary.info}</a></p>
    {error ? <p className="form-error" role="alert">{dictionary[error]}</p> : null}
    {success ? <p role="status">{dictionary.saved}</p> : null}
    <div className="form-actions"><button type="submit" className="secondary-button"
      disabled={pending || (selected && !configured) || (selected === saved && !error)}>
      {pending ? dictionary.saving : error ? dictionary.retry : dictionary.save}
    </button></div>
  </form>;
}
