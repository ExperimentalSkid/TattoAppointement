"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import type { PasswordRecoveryCopy } from "@/lib/password-recovery-copy";
import { AuthFeedback } from "@/components/auth-feedback";

export function ForgotPasswordForm({ copy }: { copy: PasswordRecoveryCopy }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current || sent) return;
    inFlightRef.current = true;
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
      inFlightRef.current = false;
      setPending(false);
    }
  }

  if (sent) return <AuthFeedback role="status">{copy.sent}</AuthFeedback>;

  return (
    <form className="auth-form" onSubmit={submit} onChange={() => setError(null)} aria-busy={pending}>
      <div className="field">
        <label htmlFor="recovery-email">{copy.email}</label>
        <input id="recovery-email" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} disabled={pending} required />
      </div>
      {error ? <AuthFeedback id="recovery-error">{error}</AuthFeedback> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? copy.sending : copy.send}</button>
    </form>
  );
}

export function ResetPasswordForm({ token, copy }: { token: string; copy: PasswordRecoveryCopy }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<{ message: string; mismatch: boolean; attempt: number } | null>(null);
  const inFlightRef = useRef(false);
  const attemptRef = useRef(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current || done || invalid) return;
    inFlightRef.current = true;
    attemptRef.current += 1;
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setError({ message: copy.mismatch, mismatch: true, attempt: attemptRef.current });
      inFlightRef.current = false;
      return;
    }
    setPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        if (result.error.code === "INVALID_TOKEN") {
          setInvalid(true);
          setError({ message: copy.invalid, mismatch: false, attempt: attemptRef.current });
        } else {
          setError({ message: copy.resetError, mismatch: false, attempt: attemptRef.current });
        }
      } else {
        setDone(true);
        // Remove the single-use token from the browser's address/history entry.
        window.history.replaceState(null, "", "/reset-password");
      }
    } catch {
      setError({ message: copy.resetError, mismatch: false, attempt: attemptRef.current });
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  if (done) return <AuthFeedback role="status">{copy.success}</AuthFeedback>;

  return (
    <form className="auth-form" onSubmit={submit} onChange={() => setError(null)} aria-busy={pending}>
      {invalid ? null : <>
        <div className="field">
          <label htmlFor="recovery-password">{copy.password}</label>
          <input id="recovery-password" name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} disabled={pending} required aria-describedby="recovery-help" />
          <p id="recovery-help" className="field-help">{copy.help}</p>
        </div>
        <div className="field">
          <label htmlFor="recovery-confirm">{copy.confirm}</label>
          <input id="recovery-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} disabled={pending} required aria-invalid={error?.mismatch || undefined} aria-describedby={error?.mismatch ? "recovery-reset-error" : undefined} />
        </div>
      </>}
      {error ? <AuthFeedback id="recovery-reset-error" focusVersion={error.attempt}>{error.message}</AuthFeedback> : null}
      {invalid ? <Link className="primary-button button-link" href="/forgot-password">{copy.retry}</Link> : <button className="primary-button" type="submit" disabled={pending}>{pending ? copy.resetting : copy.reset}</button>}
    </form>
  );
}
