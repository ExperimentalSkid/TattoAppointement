"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/i18n";
import { AccountExportButton } from "@/components/account-export-button";
import { AccountErasureForm } from "@/components/account-erasure-form";
import { authClient } from "@/lib/auth-client";
import { clearAppointmentDrafts } from "@/lib/appointment-draft";
import { capturePendingInvitation, clearPendingInvitation } from "@/lib/invitation-browser";
import "./paused-account.css";

export function PausedAccount({ identity, locale }: { identity: { id: string; email: string }; locale: Locale }) {
  const es = locale === "es";
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    // A paused account cannot use an invitation to restore workspace access.
    capturePendingInvitation(identity.id);
    clearPendingInvitation();
  }, [identity.id]);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSigningOut(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out unavailable");
      clearPendingInvitation();
      clearAppointmentDrafts();
      window.location.replace("/sign-in");
    } catch {
      inFlight.current = false;
      setSigningOut(false);
      setError(true);
    }
  }

  return <div className="paused-account">
    <p className="paused-account-identity">{es ? "Has iniciado sesión como" : "Signed in as"}<strong>{identity.email}</strong></p>
    <p className="muted-copy">{es ? "Pide a Tinta que reactive tu acceso. Mientras tanto, puedes descargar tus datos o solicitar la eliminación de tu cuenta." : "Ask Tinta to restore your access. Meanwhile, you can download your data or request deletion of your account."}</p>
    <button type="button" className="primary-button paused-access-check" disabled={refreshing || signingOut} aria-busy={refreshing} onClick={() => refresh(() => router.refresh())}>{refreshing ? (es ? "Comprobando…" : "Checking…") : (es ? "Comprobar acceso" : "Check access")}</button>
    <section className="paused-account-data">
      <h2>{es ? "Tus datos" : "Your data"}</h2>
      <AccountExportButton copy={{ export: es ? "Descargar mis datos" : "Download my data", exportLoading: es ? "Preparando descarga…" : "Preparing download…", exportError: es ? "No se pudo preparar la descarga. Inténtalo de nuevo." : "Could not prepare the download. Try again.", exportRetry: es ? "Reintentar descarga" : "Retry download", exportStarted: es ? "Descarga iniciada." : "Download started." }} />
      <AccountErasureForm locale={locale} email={identity.email} />
    </section>
    <button type="button" className="secondary-button paused-signout" onClick={signOut} disabled={signingOut || refreshing}>{signingOut ? (es ? "Cerrando sesión…" : "Signing out…") : (es ? "Cerrar sesión" : "Sign out")}</button>
    {error ? <p className="form-error" role="alert">{es ? "No se pudo cerrar la sesión. Inténtalo de nuevo." : "Could not sign out. Try again."}</p> : null}
  </div>;
}
