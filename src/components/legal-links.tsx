import Link from "next/link";
import type { Locale } from "@/i18n";
import "./legal.css";

export function LegalLinks({ locale, className = "" }: { locale: Locale; className?: string }) {
  const es = locale === "es";
  return (
    <nav className={`legal-links ${className}`.trim()} aria-label={es ? "Información legal" : "Legal information"}>
      <Link href={`/privacy?lang=${locale}`}>{es ? "Privacidad" : "Privacy"}</Link>
      <Link href={`/cookies?lang=${locale}`}>{es ? "Cookies y almacenamiento" : "Cookies and storage"}</Link>
      <Link href={`/legal?lang=${locale}`}>{es ? "Aviso legal" : "Legal notice"}</Link>
    </nav>
  );
}

export function HealthDataHint({ locale, id }: { locale: Locale; id?: string }) {
  return <p id={id} className="health-data-hint">{locale === "es"
    ? "Usa las notas para organizar el trabajo. No incluyas diagnósticos, alergias, historiales médicos ni documentos de identidad; gestiona esa información por un canal específico y adecuado."
    : "Use notes to organise your work. Do not include diagnoses, allergies, medical histories or identity documents; handle that information through a suitable dedicated channel."}</p>;
}
