"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "@/i18n";
import type { Dictionary } from "@/i18n/dictionaries";
import { authClient } from "@/lib/auth-client";

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

  async function persistLanguage(language: Locale) {
    await fetch("/api/preferences/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

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
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {mode === "sign-up" ? (
        <div className="field">
          <label htmlFor="name">{copy.name}</label>
          <input id="name" name="name" autoComplete="name" required />
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
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">{copy.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          maxLength={128}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          required
        />
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="primary-button" type="submit" disabled={pending}>
        {mode === "sign-in" ? copy.signIn : copy.signUp}
      </button>
    </form>
  );
}
