"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Locale } from "@/i18n";

const WorkspaceAccessContext = createContext<(() => void) | null>(null);

export function WorkspaceAccess({ children, locale }: { children: ReactNode; locale: Locale }) {
  const [allowed, setAllowed] = useState(true);
  const clear = useCallback(() => setAllowed(false), []);

  return <WorkspaceAccessContext.Provider value={clear}>
    {allowed ? children : <main className="route-message" role="status" aria-live="polite">
      <p>{locale === "es" ? "Abriendo tu espacio de trabajo…" : "Opening your workspace…"}</p>
    </main>}
  </WorkspaceAccessContext.Provider>;
}

export function useClearWorkspace() {
  const clear = useContext(WorkspaceAccessContext);
  if (!clear) throw new Error("Workspace access must be provided by the authenticated shell.");
  return clear;
}
