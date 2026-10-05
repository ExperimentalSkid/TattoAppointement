"use client";

import { useId, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { Locale } from "@/i18n";
import { AuthFeedback } from "@/components/auth-feedback";
import { emitDiagnostic } from "@/lib/client-diagnostics";
import { useRememberLogin } from "@/components/remember-login-choice";
import { persistLoginPreference } from "@/lib/login-preference";
import "./google-sign-in.css";

function GoogleButton({ locale, link = false, available = true, prominent = false }: { locale: Locale; link?: boolean; available?: boolean; prominent?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const inFlightRef = useRef(false);
  const unavailableId = useId();
  const es = locale === "es";
  const loginChoice = useRememberLogin();

  async function signIn() {
    if (!available || inFlightRef.current || (!link && loginChoice && !loginChoice.beginLogin())) return;
    inFlightRef.current = true;
    setPending(true);
    setError(false);
    try {
      if (!link) await persistLoginPreference(loginChoice?.remember ?? false);
      const result = link
        ? await authClient.linkSocial({ provider: "google", callbackURL: "/settings", errorCallbackURL: "/settings?error=oauth" })
        : await authClient.signIn.social({ provider: "google", callbackURL: "/calendar", errorCallbackURL: "/sign-in?error=oauth" });
      if (result.error) {
        emitDiagnostic("auth_sign_in_failed", { outcome: "failed", reason: "response" });
        setError(true);
        inFlightRef.current = false;
        setPending(false);
        if (!link) loginChoice?.endLogin();
      }
    } catch {
      emitDiagnostic("auth_sign_in_failed", { outcome: "failed", reason: "network" });
      setError(true);
      inFlightRef.current = false;
      setPending(false);
      if (!link) loginChoice?.endLogin();
    }
  }

  return (
    <div className="google-auth-option" data-prominent={prominent || undefined}>
      <button type="button" className="google-auth-button" disabled={pending || !available || (!link && loginChoice?.pending)} onClick={signIn} aria-busy={pending} aria-describedby={!available ? unavailableId : undefined}>
        {/* Official Google brand asset; a fixed local icon needs no optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/google-g.png" width="20" height="20" alt="" />
        <span>{pending ? (es ? "Conectando…" : "Connecting…") : link ? (es ? "Conectar con Google" : "Connect with Google") : prominent ? (es ? "Iniciar sesión con Google" : "Sign in with Google") : (es ? "Continuar con Google" : "Continue with Google")}</span>
      </button>
      {!available ? <p id={unavailableId} className="google-auth-unavailable muted-copy">{es ? "El acceso con Google aún no está disponible. Puedes entrar con tu correo abajo." : "Google sign-in isn’t available yet. You can sign in with email below."}</p> : null}
      {error ? <AuthFeedback>{es ? "No se pudo conectar con Google. Usa la cuenta del artista e inténtalo de nuevo." : "Could not connect with Google. Use the artist’s account and try again."}</AuthFeedback> : null}
    </div>
  );
}

export function GoogleSignInButton({ locale, available = true, prominent = false }: { locale: Locale; available?: boolean; prominent?: boolean }) {
  return <GoogleButton locale={locale} available={available} prominent={prominent} />;
}

export function GoogleLinkButton({ locale }: { locale: Locale }) {
  return <GoogleButton locale={locale} link />;
}
