"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/i18n";
import { clearAppointmentDrafts } from "@/lib/appointment-draft";
import { clearPendingInvitation } from "@/lib/invitation-browser";

export function AccountErasureForm({ locale, email, pendingActivation = false }: { locale: Locale; email: string; pendingActivation?: boolean }) {
  const es = locale === "es";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(null);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/account/erase", { method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: values.get("confirmation"), retentionReviewed: values.get("retentionReviewed") === "on" }) });
      const result = await response.json();
      if (response.status === 403 && result.error === "reauthenticate") {
        setError(es ? "Vuelve a iniciar sesión y revisa la eliminación. Se requiere un acceso de los últimos 10 minutos." : "Sign in again and review deletion. A sign-in within the last 10 minutes is required.");
        return;
      }
      if (!response.ok || result.accepted !== true || typeof result.complete !== "boolean") throw new Error("unavailable");
      clearAppointmentDrafts();
      clearPendingInvitation();
      window.location.replace(`/privacy?erasure=${result.complete ? "complete" : "pending"}&lang=${locale}`);
    } catch {
      setError(es ? "No se pudo confirmar la solicitud. Comprueba tu conexión; no se ha mostrado una confirmación de eliminación." : "Could not confirm the request. Check your connection; no deletion confirmation has been received.");
    } finally { inFlight.current = false; setPending(false); }
  }
  return <details className="workspace-section">
    <summary>{pendingActivation ? (es ? "Eliminar mi registro" : "Delete my registration") : (es ? "Eliminar mi cuenta y espacio" : "Delete my account and workspace")}</summary>
    <p className="muted-copy">{pendingActivation ? (es ? "Elimina tu cuenta, sesiones e informes de esta instalación. Descarga primero los datos de tu registro que quieras conservar." : "Deletes your account, sessions and reports from this installation. Download any registration data you want to keep first.") : (es ? "Elimina tu cuenta, sesiones, clientes, citas, pagos manuales, diseños privados e informes de esta instalación. Exporta primero lo que debas conservar. Revisa tus obligaciones legales como responsable de los datos de tus clientes." : "Deletes your account, sessions, clients, appointments, manual payments, private designs and reports from this installation. Export anything you must retain first. Review your legal duties as the controller of your clients’ data.")}</p>
    <p className="muted-copy">{es ? "Si falla la limpieza, el acceso se revoca y la solicitud queda pendiente para reintento. Las copias de seguridad y la conservación exigida por ley requieren revisión del operador; consulta Privacidad." : "If cleanup fails, access is revoked and the request remains pending for retry. Backups and legally required retention need operator review; see Privacy."}</p>
    <form onSubmit={submit} aria-busy={pending} className="client-form" data-sync-protect data-sync-pending={pending}>
      <div className="field"><label htmlFor="erase-account-email">{es ? `Escribe ${email} para confirmar` : `Type ${email} to confirm`}</label><input id="erase-account-email" name="confirmation" type="email" autoComplete="off" maxLength={254} required disabled={pending} /></div>
      <label className="privacy-choice"><input type="checkbox" name="retentionReviewed" required disabled={pending} />{pendingActivation ? (es ? "He revisado y descargado los datos que quiero conservar y solicito eliminar mi registro." : "I have reviewed and downloaded the data I want to keep and request deletion of my registration.") : (es ? "He revisado y exportado los datos que debo conservar y solicito eliminar este espacio." : "I have reviewed and exported the records I must keep and request deletion of this workspace.")}</label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="secondary-button" disabled={pending}>{pending ? (es ? "Procesando…" : "Processing…") : pendingActivation ? (es ? "Eliminar permanentemente mi registro" : "Permanently delete my registration") : (es ? "Eliminar permanentemente mi espacio" : "Permanently delete my workspace")}</button>
    </form>
  </details>;
}
