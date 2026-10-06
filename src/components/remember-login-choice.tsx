"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/i18n";

type LoginChoice = { remember: boolean; pending: boolean; beginLogin: () => boolean; endLogin: () => void };
const LoginChoiceContext = createContext<LoginChoice | null>(null);

export function RememberLoginChoice({ children, locale }: { children: ReactNode; locale: Locale }) {
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const beginLogin = useCallback(() => {
    if (inFlight.current) return false;
    inFlight.current = true; setPending(true); return true;
  }, []);
  const endLogin = useCallback(() => { inFlight.current = false; setPending(false); }, []);

  return <LoginChoiceContext.Provider value={{ remember, pending, beginLogin, endLogin }}>
    <label className="field-help" style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "16px 0" }}>
      <input type="checkbox" name="rememberLogin" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} style={{ flexShrink: 0, marginTop: 3 }} />
      <span>{locale === "es" ? "Mantener mi sesión en este dispositivo (30 días)" : "Keep me signed in on this device (30 days)"}</span>
    </label>
    {children}
  </LoginChoiceContext.Provider>;
}

export function useRememberLogin() { return useContext(LoginChoiceContext); }
