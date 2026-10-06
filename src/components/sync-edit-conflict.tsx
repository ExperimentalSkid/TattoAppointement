"use client";

import { useEffect, useRef } from "react";

export function SyncEditConflict({ locale, href }: { locale: "en" | "es"; href: string }) {
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedbackRef.current?.focus(); }, []);
  return <div ref={feedbackRef} tabIndex={-1} role="alert" data-sync-conflict className="appointment-error-summary">
    <p className="form-error">{locale === "es"
      ? "Este registro cambió en otro dispositivo. Tus cambios sin guardar siguen aquí. Revisa la última versión antes de volver a guardar."
      : "This record changed on another device. Your unsaved changes are still here. Review the latest version before saving again."}</p>
    <a className="text-link" href={href} target="_blank" rel="noopener noreferrer">{locale === "es" ? "Revisar la última versión" : "Review latest version"}</a>
  </div>;
}
