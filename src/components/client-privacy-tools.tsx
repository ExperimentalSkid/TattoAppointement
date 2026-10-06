"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/i18n";
import { CLIENT_FIELD_LIMITS } from "@/lib/client-fields";

const copy = {
  en: {
    title: "Client privacy tools", export: "Download client data", exporting: "Preparing download…", exported: "Client data download started.",
    scope: "Download this client's contact details, notes, appointments, recorded payments and links to attached artwork. Artwork files are downloaded separately through those links. Keep the downloaded file private.",
    erase: "Permanently erase client history", erasing: "Erasing…", retry: "Retry erasure",
    warning: "Erasure permanently removes this client's record, appointments and recorded payments from this workspace. Export any records that must be retained before proceeding, and retain them securely for the applicable period.",
    artwork: "Artwork stays in your shared library, including any personal information in its images, titles or notes. Review and remove that information separately using the artwork controls.",
    designs: "Review artwork library", retention: "I reviewed retention obligations and securely retained any required records before requesting erasure.",
    artworkReview: "I reviewed personal information in shared artwork and will remove it separately where required.",
    instruction: "These confirmations are your instruction as the artist responsible for this client. They are not the client's GDPR consent. Server backups and any legally restricted retention require the operator's separate procedure.",
    confirm: "Type the client's exact name to confirm", again: "Sign out and sign in again, then review this client before retrying. Erasure requires a sign-in within the last 10 minutes.",
    signOut: "Open Settings to sign out", stale: "The client or their history changed. Review the current record in a new tab, then reload this page before retrying. Your confirmations are still here.",
    review: "Review current client", missing: "This client is no longer available in your workspace. Nothing was erased by this request.",
    mixed: "Some linked records need an ownership review. Nothing was erased. Contact the operator before retrying.",
    invalid: "Enter the client's exact name and complete both review confirmations before retrying.",
    unavailable: "Could not complete this request. Your confirmations are still here. Check your connection and retry manually.",
    exportError: "Could not download valid client data. Check your connection and retry manually.", exportRetry: "Retry client data download",
  },
  es: {
    title: "Herramientas de privacidad del cliente", export: "Descargar datos del cliente", exporting: "Preparando descarga…", exported: "La descarga de datos del cliente ha comenzado.",
    scope: "Descarga los contactos, notas, citas, pagos registrados y enlaces a los diseños asociados de este cliente. Los archivos de los diseños se descargan por separado desde esos enlaces. Guarda la descarga de forma privada.",
    erase: "Eliminar el historial del cliente definitivamente", erasing: "Eliminando…", retry: "Reintentar eliminación",
    warning: "La eliminación borra definitivamente la ficha, las citas y los pagos registrados de este cliente de tu espacio. Exporta antes los documentos que debas conservar y guárdalos de forma segura durante el plazo aplicable.",
    artwork: "Los diseños permanecen en tu biblioteca compartida, incluidos los datos personales de sus imágenes, títulos o notas. Revisa y elimina esos datos por separado con los controles de diseños.",
    designs: "Revisar biblioteca de diseños", retention: "He revisado las obligaciones de conservación y guardado de forma segura los documentos necesarios antes de solicitar la eliminación.",
    artworkReview: "He revisado los datos personales de los diseños compartidos y los eliminaré por separado cuando corresponda.",
    instruction: "Estas confirmaciones son tu instrucción como artista responsable de este cliente. No son el consentimiento RGPD del cliente. Las copias de seguridad y la conservación legal restringida requieren un procedimiento separado del operador.",
    confirm: "Escribe el nombre exacto del cliente para confirmar", again: "Cierra la sesión e inicia sesión de nuevo; después revisa al cliente antes de reintentar. La eliminación requiere un inicio de sesión en los últimos 10 minutos.",
    signOut: "Abrir Ajustes para cerrar sesión", stale: "La ficha o el historial del cliente han cambiado. Revisa la ficha actual en otra pestaña y recarga esta página antes de reintentar. Tus confirmaciones siguen aquí.",
    review: "Revisar ficha actual", missing: "Este cliente ya no está disponible en tu espacio. Esta solicitud no ha eliminado ningún dato.",
    mixed: "Algunos registros asociados requieren revisar su propietario. No se ha eliminado ningún dato. Contacta con el operador antes de reintentar.",
    invalid: "Escribe el nombre exacto del cliente y completa ambas confirmaciones antes de reintentar.",
    unavailable: "No se ha podido completar la solicitud. Tus confirmaciones siguen aquí. Comprueba la conexión y reintenta manualmente.",
    exportError: "No se han podido descargar datos válidos del cliente. Comprueba la conexión y reintenta manualmente.", exportRetry: "Reintentar descarga del cliente",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validExport(value: unknown, clientId: string) {
  return isRecord(value) && value.version === 1 && value.scope === "client" && isRecord(value.client) && value.client.id === clientId
    && typeof value.client.name === "string" && ["appointments", "payments", "designs"].every(key => Array.isArray(value[key]));
}

type Failure = "reauthenticate" | "unauthorized" | "stale" | "not_found" | "mixed_ownership" | "confirmation" | "invalid_instruction" | "unavailable";

export function ClientPrivacyTools({ clientId, clientName, expectedVersion, locale }: {
  clientId: string; clientName: string; expectedVersion: string; locale: Locale;
}) {
  const text = copy[locale];
  const router = useRouter();
  const fieldId = useId();
  const [review] = useState({ clientId, clientName, expectedVersion });
  const [confirmation, setConfirmation] = useState("");
  const [retentionReviewed, setRetentionReviewed] = useState(false);
  const [artworkReviewed, setArtworkReviewed] = useState(false);
  const [pending, setPending] = useState<"export" | "erase" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [exportStatus, setExportStatus] = useState<"idle" | "error" | "started">("idle");
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);

  async function download() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending("export");
    setExportStatus("idle");
    let url: string | null = null;
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(review.clientId)}/export`, {
        credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      });
      if (response.status === 401) { setFailure("unauthorized"); throw new Error("unauthorized"); }
      if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("invalid_export");
      const blob = await response.blob();
      if (!validExport(JSON.parse(await blob.text()), review.clientId)) throw new Error("invalid_export");
      if (!mounted.current || controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tinta-client-data.json";
      link.hidden = true;
      try { document.body.append(link); link.click(); } finally { link.remove(); }
      const handedOffUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(handedOffUrl), 30_000);
      url = null;
      setExportStatus("started");
    } catch { if (mounted.current && !controller.signal.aborted) setExportStatus("error"); }
    finally {
      if (url) URL.revokeObjectURL(url);
      if (request.current === controller) { request.current = null; if (mounted.current) setPending(null); }
    }
  }

  async function erase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    if (confirmation !== review.clientName || !retentionReviewed || !artworkReviewed) { setFailure("invalid_instruction"); return; }
    const controller = new AbortController();
    request.current = controller;
    setPending("erase");
    setFailure(null);
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(review.clientId)}/erase`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        body: JSON.stringify({ confirmation, expectedVersion: review.expectedVersion, retentionReviewed, artworkReviewed }),
      });
      const result: unknown = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (response.ok && isRecord(result) && result.erased === true) { router.push("/clients"); router.refresh(); return; }
      const safeErrors: Failure[] = ["reauthenticate", "unauthorized", "stale", "not_found", "mixed_ownership", "confirmation", "invalid_instruction"];
      setFailure(isRecord(result) && safeErrors.includes(result.error as Failure) ? result.error as Failure : "unavailable");
    } catch { if (mounted.current && !controller.signal.aborted) setFailure("unavailable"); }
    finally { if (request.current === controller) { request.current = null; if (mounted.current) setPending(null); } }
  }

  const authFailure = failure === "unauthorized" || failure === "reauthenticate";
  const message = authFailure ? text.again : failure === "stale" ? text.stale : failure === "not_found" ? text.missing
    : failure === "mixed_ownership" ? text.mixed : failure === "confirmation" || failure === "invalid_instruction" ? text.invalid : text.unavailable;
  return <details className="workspace-section client-privacy-tools" data-sync-protect data-sync-dirty={Boolean(confirmation || retentionReviewed || artworkReviewed)} data-sync-pending={Boolean(pending)}>
    <summary>{text.title}</summary>
    <div className="section-intro">
      <p className="form-note">{text.scope}</p>
      <button type="button" className="secondary-button" onClick={download} disabled={Boolean(pending)} aria-busy={pending === "export"}>
        {pending === "export" ? text.exporting : exportStatus === "error" ? text.exportRetry : text.export} <span aria-hidden="true">↓</span>
      </button>
      {exportStatus === "error" ? <p className="form-error" role="alert">{text.exportError}</p> : exportStatus === "started" ? <p className="form-note" role="status">{text.exported}</p> : null}
      <p>{text.warning}</p>
      <p className="form-note">{text.artwork} <Link className="text-link" href="/designs">{text.designs}</Link></p>
      <form className="client-form" onSubmit={erase} aria-busy={pending === "erase"}>
        <label className="privacy-choice"><input type="checkbox" name="retentionReviewed" checked={retentionReviewed} onChange={event => setRetentionReviewed(event.target.checked)} disabled={Boolean(pending)} required /> {text.retention}</label>
        <label className="privacy-choice"><input type="checkbox" name="artworkReviewed" checked={artworkReviewed} onChange={event => setArtworkReviewed(event.target.checked)} disabled={Boolean(pending)} required /> {text.artworkReview}</label>
        <p className="form-note">{text.instruction}</p>
        <div className="field">
          <label htmlFor={fieldId}>{text.confirm}: <strong>{review.clientName}</strong></label>
          <input id={fieldId} name="confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" maxLength={CLIENT_FIELD_LIMITS.name} disabled={Boolean(pending)} required />
        </div>
        {failure ? <p className="form-error" role="alert">{message} {authFailure ? <Link className="text-link" href="/settings">{text.signOut}</Link> : failure === "stale" ? <Link className="text-link" href={`/clients/${encodeURIComponent(review.clientId)}`} target="_blank" rel="noopener">{text.review}</Link> : null}</p> : null}
        <div className="form-actions"><button className="secondary-button" type="submit" disabled={Boolean(pending)} aria-busy={pending === "erase"}>
          {pending === "erase" ? text.erasing : failure ? text.retry : text.erase}
        </button></div>
      </form>
    </div>
  </details>;
}
