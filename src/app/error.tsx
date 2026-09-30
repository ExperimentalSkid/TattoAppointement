"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const es = typeof document === "undefined" || document.documentElement.lang === "es";
  return <main className="route-message"><p className="eyebrow">TINTA</p><h1>{es ? "No se pudo cargar esta página" : "This page couldn’t load"}</h1><p>{es ? "Inténtalo de nuevo en un momento. Si acababas de guardar algo, comprueba el registro antes de repetirlo." : "Try again in a moment. If you just saved something, check the record before repeating it."}</p><div className="form-actions"><button className="primary-button" onClick={reset}>{es ? "Reintentar" : "Try again"}</button><Link className="secondary-button button-link" href="/calendar">{es ? "Volver a la agenda" : "Back to calendar"}</Link></div></main>;
}
