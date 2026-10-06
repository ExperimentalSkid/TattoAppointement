"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/i18n";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { RememberLoginChoice } from "@/components/remember-login-choice";
import { AuthFeedback } from "@/components/auth-feedback";
import { AccountExportButton } from "@/components/account-export-button";
import { AccountErasureForm } from "@/components/account-erasure-form";
import { authClient } from "@/lib/auth-client";
import { capturePendingInvitation, clearPendingInvitation } from "@/lib/invitation-browser";
import "./join-activation.css";

export function ActiveJoinRedirect({ locale }: { locale: Locale }) {
  useEffect(() => {
    capturePendingInvitation(null);
    clearPendingInvitation();
    window.location.replace("/calendar");
  }, []);
  return <p className="muted-copy" role="status">{locale === "es" ? "Abriendo tu estudio…" : "Opening your workspace…"}</p>;
}

export function JoinActivation({ locale, identity, googleAvailable, canSignUp }: {
  locale: Locale;
  identity: { id: string; email: string } | null;
  googleAvailable: boolean;
  canSignUp: boolean;
}) {
  const es = locale === "es";
  const [code, setCode] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [preserved, setPreserved] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let frame: number | null = null;
    function capture() {
      const invitation = capturePendingInvitation(identity?.id ?? null);
      if (frame !== null) cancelAnimationFrame(frame);
      // Fragment access is a browser-only external source, after hydration.
      frame = requestAnimationFrame(() => {
        setCode(invitation.code);
        setPreserved(invitation.preserved);
        setLoaded(true);
        setError(null);
        frame = null;
      });
    }
    function hashChanged() {
      if (new URLSearchParams(window.location.hash.slice(1)).has("code")) capture();
    }
    window.addEventListener("hashchange", hashChanged);
    capture();
    return () => {
      window.removeEventListener("hashchange", hashChanged);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [identity?.id]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    let leaving = false;
    try {
      const response = await fetch("/api/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const result = await response.json() as { status?: string; retryAfterSeconds?: number };
      if (!response.ok) {
        if (response.status === 401) {
          setError(es ? "Tu sesión ha terminado. Vuelve a iniciar sesión y usa tu invitación." : "Your session has ended. Sign in again and use your invitation.");
        } else if (response.status === 429) {
          setError(es ? "Has hecho varios intentos. Espera un momento antes de volver a probar." : "You have made several attempts. Wait a moment before trying again.");
        } else {
          setError(es ? "Esta invitación no está disponible. Comprueba el código o pide una nueva." : "This invitation is unavailable. Check the code or ask for a new one.");
        }
        return;
      }
      if (result.status !== "activated" && result.status !== "already_active") throw new Error("Unexpected activation response");
      clearPendingInvitation();
      window.location.replace("/calendar");
      leaving = true;
    } catch {
      setError(es ? "No se pudo activar tu cuenta. Comprueba tu conexión e inténtalo de nuevo." : "Could not activate your account. Check your connection and try again.");
    } finally {
      if (!leaving) { inFlight.current = false; setPending(false); }
    }
  }

  async function changeAccount() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      clearPendingInvitation();
      window.location.replace("/join");
    } catch {
      inFlight.current = false;
      setPending(false);
      setError(es ? "No se pudo cerrar la sesión. Inténtalo de nuevo." : "Could not sign out. Try again.");
    }
  }

  return <div className="join-activation">
    {!identity ? <>
      <p className="join-step">{es ? "01 · TU CUENTA" : "01 · YOUR ACCOUNT"}</p>
      <p className="muted-copy">{es ? "Entra con la cuenta que usarás en tu estudio. Después podrás activar tu acceso con la invitación." : "Sign in with the account you will use in your studio. Then activate your access with the invitation."}</p>
      {!loaded ? <p className="muted-copy" role="status">{es ? "Preparando tu invitación…" : "Preparing your invitation…"}</p> : <>
        {code ? <p className="join-invitation-ready" role="status">{es ? "Tu invitación está lista para el siguiente paso." : "Your invitation is ready for the next step."}</p> : null}
        {!preserved ? <p className="muted-copy">{es ? "Tu navegador no puede conservar el código durante el acceso. Guárdalo para introducirlo después:" : "Your browser cannot keep the code during sign-in. Save it to enter afterward:"} <span className="join-code-fallback">{code}</span></p> : null}
        <RememberLoginChoice locale={locale}>
          <GoogleSignInButton locale={locale} available={googleAvailable} prominent activation />
        </RememberLoginChoice>
        <p className="join-email-links"><Link className="text-link" href="/sign-in">{es ? "Entrar con correo y contraseña" : "Sign in with email and password"}</Link>{canSignUp ? <Link className="text-link" href="/sign-up">{es ? "Crear una cuenta con correo" : "Create an account with email"}</Link> : null}</p>
      </>}
    </> : <>
      <p className="join-step">{es ? "02 · TU INVITACIÓN" : "02 · YOUR INVITATION"}</p>
      <p className="join-account">{es ? "Has iniciado sesión como" : "Signed in as"} <strong>{identity.email}</strong></p>
      <form className="auth-form join-form" onSubmit={redeem} aria-busy={pending}>
        <div className="field">
          <label htmlFor="invitation-code">{es ? "Código de invitación" : "Invitation code"}</label>
          <input ref={codeInput} id="invitation-code" name="invitationCode" value={code} onChange={event => { setCode(event.target.value); setError(null); }} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={128} required disabled={pending || !loaded} aria-describedby="invitation-help" />
          <p id="invitation-help" className="field-help">{es ? "Pega el código que te ha enviado Tinta." : "Paste the code Tinta sent you."}</p>
        </div>
        {error ? <AuthFeedback>{error}</AuthFeedback> : null}
        <button className="primary-button" disabled={pending || !loaded} type="submit">{pending ? (es ? "Activando…" : "Activating…") : (es ? "Activar mi estudio" : "Activate my workspace")}</button>
      </form>
      <button className="secondary-button join-change-account" type="button" onClick={changeAccount} disabled={pending}>{es ? "Cambiar de cuenta" : "Change account"}</button>
      <p className="muted-copy join-no-code">{es ? "¿Todavía no tienes invitación? Pide un código a Tinta para acceder a la beta privada." : "No invitation yet? Ask Tinta for a code to access the private beta."}</p>
      <section className="join-own-data">
        <h2>{es ? "Tu registro" : "Your registration"}</h2>
        <AccountExportButton copy={{ export: es ? "Descargar los datos de mi registro" : "Download my registration data", exportLoading: es ? "Preparando descarga…" : "Preparing download…", exportError: es ? "No se pudo preparar la descarga. Inténtalo de nuevo." : "Could not prepare the download. Try again.", exportRetry: es ? "Reintentar descarga" : "Retry download", exportStarted: es ? "Descarga iniciada." : "Download started." }} />
        <AccountErasureForm locale={locale} email={identity.email} pendingActivation />
      </section>
    </>}
  </div>;
}
