import Link from "next/link";
import { getDictionary } from "@/i18n";

export default async function NotFound() {
  const { locale } = await getDictionary();
  const es = locale === "es";
  return <main className="route-message"><p className="eyebrow">404 · TINTA</p><h1>{es ? "Aquí no hay nada que ver" : "Nothing to see here"}</h1><p>{es ? "Este registro no está disponible. Vuelve a tu agenda para continuar." : "This record is unavailable. Head back to your calendar to continue."}</p><Link className="primary-button button-link" href="/calendar">{es ? "Volver a la agenda" : "Back to calendar"}</Link></main>;
}
