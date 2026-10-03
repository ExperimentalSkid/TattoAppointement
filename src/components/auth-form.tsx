"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "@/i18n";
import type { Dictionary } from "@/i18n/dictionaries";
import { authClient } from "@/lib/auth-client";
import { AuthFeedback } from "@/components/auth-feedback";

export function AuthForm({
  mode,
  copy,
  locale,
}: {
  mode: "sign-in" | "sign-up";
  copy: Dictionary["auth"];
  locale: Locale;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const inFlightRef = useRef(false);

  async function persistLanguage(language: Locale) {
    try {
      await fetch("/api/preferences/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
    } catch {
      // Preference synchronization must not block successful authentication.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    let leaving = false;
    try {
      if (mode === "sign-in") {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) {
          setError(copy.invalid);
          return;
        }

        const preferredLanguage = (result.data?.user as { language?: unknown } | undefined)
          ?.language;
        if (preferredLanguage === "en" || preferredLanguage === "es") {
          await persistLanguage(preferredLanguage);
        }
      } else {
        const name = String(formData.get("name") ?? "").trim();
        const result = await authClient.signUp.email({ name, email, password });
        if (result.error) {
          setError(copy.signupError);
          return;
        }
        await persistLanguage(locale);
      }

      window.location.replace("/calendar");
      leaving = true;
    } catch {
      setError(locale === "es" ? "No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo." : "Could not connect. Check your connection and try again.");
    } finally {
      if (!leaving) {
        inFlightRef.current = false;
        setPending(false);
      }
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} onChange={() => setError(null)} aria-busy={pending}>
      {mode === "sign-up" ? (
        <div className="field">
          <label htmlFor="name">{copy.name}</label>
          <input id="name" name="name" autoComplete="name" maxLength={80} disabled={pending} required />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="email">{copy.email}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          disabled={pending}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">{copy.password}</label>
        <div className="password-input">
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          minLength={8}
          maxLength={128}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          disabled={pending}
          required
        />
        <button type="button" className="password-toggle" disabled={pending} onClick={() => setShowPassword(!showPassword)} aria-label={locale === "es" ? (showPassword ? "Ocultar contraseña" : "Mostrar contraseña") : (showPassword ? "Hide password" : "Show password")} aria-pressed={showPassword}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPassword ? <path d="m3 3 18 18" /> : null}</svg>
        </button>
        </div>
        {mode === "sign-up" ? <p className="field-help">{locale === "es" ? "Al menos 8 caracteres." : "At least 8 characters."}</p> : null}
      </div>

      {error ? <AuthFeedback id="auth-error">{error}</AuthFeedback> : null}

      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? (locale === "es" ? "Un momento…" : "Please wait…") : mode === "sign-in" ? copy.signIn : copy.signUp}
      </button>
    </form>
  );
}
