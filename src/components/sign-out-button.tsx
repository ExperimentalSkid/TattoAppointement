"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { authClient } from "@/lib/auth-client";
import { useClearWorkspace } from "@/components/workspace-access";
import { emitDiagnostic } from "@/lib/client-diagnostics";

export function SignOutButton({ label }: { label: string }) {
  const clearWorkspace = useClearWorkspace();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      flushSync(clearWorkspace);
      window.location.replace("/sign-in");
    } catch {
      emitDiagnostic("action_failed", { outcome: "failed", reason: "response" });
      setError(document.documentElement.lang === "es" ? "No se pudo cerrar la sesión. Inténtalo de nuevo." : "Sign-out failed. Please try again.");
      setPending(false);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <><button
      type="button"
      className="signout-button"
      disabled={pending}
      onClick={signOut}
    >
      {label}
    </button>{error ? <span className="form-error signout-error" role="alert">{error}</span> : null}</>
  );
}
