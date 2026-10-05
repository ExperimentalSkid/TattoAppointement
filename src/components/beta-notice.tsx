import type { Locale } from "@/i18n";
import styles from "./beta-notice.module.css";

const copy = {
  es: {
    title: "Tinta en pruebas",
    message: "Tinta está en periodo de pruebas. Queremos conservar tus datos, pero no podemos garantizar que no haya errores o pérdidas durante el desarrollo. Guarda copias independientes de tus registros importantes de citas, clientes y diseños.",
  },
  en: {
    title: "Tinta in beta",
    message: "Tinta is in a testing period. We intend to preserve your data, but cannot guarantee there will be no errors or loss during development. Keep independent copies of important appointment, client and artwork records.",
  },
} as const;

export function BetaNotice({ locale, expandable = false }: { locale: Locale; expandable?: boolean }) {
  const text = copy[locale];

  if (expandable) {
    return (
      <details className={styles.indicator}>
        <summary>{text.title}</summary>
        <p className={styles.message}>{text.message}</p>
      </details>
    );
  }

  return (
    <aside className={styles.notice} aria-label={text.title}>
      <p className={styles.title}>{text.title}</p>
      <p className={styles.message}>{text.message}</p>
    </aside>
  );
}
