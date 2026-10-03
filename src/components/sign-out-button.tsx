"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { authClient } from "@/lib/auth-client";
import { useClearWorkspace } from "@/components/workspace-access";

export function SignOutButton({ label }: { label: string }) {
  const clearWorkspace = useClearWorkspace();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const result = await authClient.signOut();
      if (result.error) { setPending(false); return; }
      flushSync(clearWorkspace);
      window.location.replace("/sign-in");
    } catch {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="signout-button"
      disabled={pending}
      onClick={signOut}
    >
      {label}
    </button>
  );
}
