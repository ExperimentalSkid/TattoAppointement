"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/i18n";

type AccessState = { enabled: boolean; deactivatedAt: string | null };
type DisabledReason = "administrator" | "invitation" | "erasure" | null;
type AccessError = "failed" | "changed" | "forbidden" | "invitation" | "erasure";

function accessResponse(value: unknown, id: string): AccessState | null {
  if (!value || typeof value !== "object" || !("artist" in value)) return null;
  const artist = value.artist;
  if (!artist || typeof artist !== "object" || !("id" in artist) || artist.id !== id
    || !("enabled" in artist) || typeof artist.enabled !== "boolean"
    || !("deactivatedAt" in artist) || !(artist.deactivatedAt === null || typeof artist.deactivatedAt === "string")) return null;
  if (typeof artist.deactivatedAt === "string" && !Number.isFinite(Date.parse(artist.deactivatedAt))) return null;
  return { enabled: artist.enabled, deactivatedAt: artist.deactivatedAt };
}

export function ArtistAccessSwitch({ id, name, enabled, deactivatedAt, canManageAccess, disabledReason, locale }: {
  id: string;
  name: string;
  enabled: boolean;
  deactivatedAt: string | null;
  canManageAccess: boolean;
  disabledReason: DisabledReason;
  locale: Locale;
}) {
  const es = locale === "es";
  const router = useRouter();
  const feedbackId = useId();
  const inFlight = useRef(false);
  const [saved, setSaved] = useState<AccessState>({ enabled, deactivatedAt });
  const [lastSnapshot, setLastSnapshot] = useState<AccessState>({ enabled, deactivatedAt });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AccessError | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // A refreshed server snapshot replaces local state without toggling optimistically.
  if (lastSnapshot.enabled !== enabled || lastSnapshot.deactivatedAt !== deactivatedAt) {
    setLastSnapshot({ enabled, deactivatedAt });
    setSaved({ enabled, deactivatedAt });
  }

  const disabledCopy = disabledReason === "administrator" ? (es ? "Tu cuenta de administrador" : "Your administrator account")
    : disabledReason === "invitation" ? (es ? "La activación requiere una invitación." : "Activation requires an invitation.")
      : disabledReason === "erasure" ? (es ? "Eliminación solicitada." : "Deletion requested.") : null;
  const errorCopy = error === "changed" ? (es ? "El acceso ha cambiado. Hemos actualizado el estado; revísalo antes de intentarlo de nuevo." : "Access has changed. We refreshed the state; review it before trying again.")
    : error === "forbidden" ? (es ? "No se puede cambiar el acceso de esta cuenta." : "This account’s access cannot be changed.")
      : error === "invitation" ? (es ? "Esta cuenta necesita su invitación original para activar el estudio." : "This account needs its original invitation to activate the workspace.")
        : error === "erasure" ? (es ? "La cuenta ha cambiado. Hemos actualizado el listado." : "The account has changed. We refreshed the list.")
          : error === "failed" ? (es ? "No se pudo guardar el cambio. El acceso anterior se conserva." : "Could not save the change. The previous access setting is kept.") : null;

  async function changeAccess() {
    if (inFlight.current || !canManageAccess) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setConfirmation(null);
    const nextEnabled = !saved.enabled;
    try {
      const response = await fetch(`/api/admin/artists/${encodeURIComponent(id)}/access`, {
        method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, expectedDeactivatedAt: saved.deactivatedAt }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        const reason = result && typeof result === "object" && "error" in result ? result.error : null;
        const current = reason === "access_conflict" ? accessResponse(result, id) : null;
        if (current) setSaved(current);
        setError(reason === "invitation_required" ? "invitation" : reason === "account_changed" ? "erasure" : "changed");
        router.refresh();
        return;
      }
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        setError("forbidden");
        router.refresh();
        return;
      }
      const state = accessResponse(result, id);
      if (!response.ok || !state || state.enabled !== nextEnabled) throw new Error("Access update unavailable");
      setSaved(state);
      setConfirmation(state.enabled ? (es ? "Acceso reactivado." : "Access restored.") : (es ? "Acceso pausado. Sus registros se conservan." : "Access paused. Their records are kept."));
      router.refresh();
    } catch {
      setError("failed");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <div className="artist-access-control">
    <button type="button" role="switch" className="artist-access-switch" aria-checked={saved.enabled}
      aria-label={es ? `Acceso al estudio de ${name}` : `Workspace access for ${name}`}
      aria-describedby={disabledCopy || errorCopy || confirmation ? feedbackId : undefined}
      disabled={pending || !canManageAccess} aria-busy={pending} onClick={changeAccess}>
      <span className="artist-access-track" aria-hidden="true"><span /></span>
      <span>{saved.enabled ? (es ? "Activo" : "Active") : disabledReason === "invitation" ? (es ? "Sin activar" : "Not activated") : (es ? "Pausado" : "Paused")}</span>
    </button>
    {disabledCopy ? <p id={feedbackId} className="artist-access-note">{disabledCopy}</p> : errorCopy ? <div id={feedbackId} className="artist-access-feedback" role="alert"><p>{errorCopy}</p>{error === "failed" || error === "changed" ? <button className="secondary-button" type="button" onClick={changeAccess} disabled={pending}>{es ? "Reintentar" : "Retry"}</button> : null}</div> : confirmation ? <p id={feedbackId} className="artist-access-note" role="status">{confirmation}</p> : null}
  </div>;
}
