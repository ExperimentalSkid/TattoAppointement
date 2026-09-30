"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import type { PasswordRecoveryCopy } from "@/lib/password-recovery-copy";

export function ForgotPasswordForm({ copy }: { copy: PasswordRecoveryCopy }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: new URL("/reset-password", window.location.origin).href,
      });
      if (result.error) {
        setError(result.error.code === "RESET_PASSWORD_DISABLED" ? copy.unavailable : copy.error);
      } else {
        setSent(true);
      }
    } catch {
      setError(copy.error);
    } finally {
      setPending(false);
    }
  }

  if (sent) return <p className="form-success" role="status">{copy.sent}</p>;

  return (
    <form className="auth-form" onSubmit={submit} aria-busy={pending}>
      <div className="field">
        <label htmlFor="recovery-email">{copy.email}</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required />
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? copy.sending : copy.send}</button>
    </form>
  );
}

export function ResetPasswordForm({ token, copy }: { token: string; copy: PasswordRecoveryCopy }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setError(copy.mismatch);
      return;
    }
    setPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        if (result.error.code === "INVALID_TOKEN") {
          setInvalid(true);
          setError(copy.invalid);
        } else {
          setError(copy.resetError);
        }
      } else {
        setDone(true);
        // Remove the single-use token from the browser's address/history entry.
        window.history.replaceState(null, "", "/reset-password");
      }
    } catch {
      setError(copy.resetError);
    } finally {
      setPending(false);
    }
  }

  if (done) return <p className="form-success" role="status">{copy.success}</p>;

  return (
    <form className="auth-form" onSubmit={submit} aria-busy={pending}>
      {invalid ? null : <>
        <div className="field">
          <label htmlFor="recovery-password">{copy.password}</label>
          <input id="recovery-password" name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="recovery-help" />
          <p id="recovery-help" className="field-help">{copy.help}</p>
        </div>
        <div className="field">
          <label htmlFor="recovery-confirm">{copy.confirm}</label>
          <input id="recovery-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
        </div>
      </>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {invalid ? <Link className="primary-button button-link" href="/forgot-password">{copy.retry}</Link> : <button className="primary-button" type="submit" disabled={pending}>{pending ? copy.resetting : copy.reset}</button>}
    </form>
  );
}
