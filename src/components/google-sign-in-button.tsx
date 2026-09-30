"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { Locale } from "@/i18n";
import "./google-sign-in.css";

function GoogleButton({ locale, link = false }: { locale: Locale; link?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const es = locale === "es";

  async function signIn() {
    setPending(true);
    setError(false);
    try {
      const result = link
        ? await authClient.linkSocial({ provider: "google", callbackURL: "/settings", errorCallbackURL: "/settings?error=oauth" })
        : await authClient.signIn.social({ provider: "google", callbackURL: "/calendar", errorCallbackURL: "/sign-in?error=oauth" });
      if (result.error) {
        setError(true);
        setPending(false);
      }
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="google-auth-option">
      <button type="button" className="google-auth-button" disabled={pending} onClick={signIn} aria-busy={pending}>
        {/* Official Google brand asset; a fixed local icon needs no optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/google-g.png" width="20" height="20" alt="" />
        <span>{pending ? (es ? "Conectando…" : "Connecting…") : link ? (es ? "Conectar con Google" : "Connect with Google") : (es ? "Continuar con Google" : "Continue with Google")}</span>
      </button>
      {error ? <p className="form-error" role="alert">{es ? "No se pudo conectar con Google. Usa la cuenta del artista e inténtalo de nuevo." : "Could not connect with Google. Use the artist’s account and try again."}</p> : null}
    </div>
  );
}

export function GoogleSignInButton({ locale }: { locale: Locale }) {
  return <GoogleButton locale={locale} />;
}

export function GoogleLinkButton({ locale }: { locale: Locale }) {
  return <GoogleButton locale={locale} link />;
}
