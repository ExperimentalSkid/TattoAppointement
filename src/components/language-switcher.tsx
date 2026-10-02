"use client";

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Locale } from "@/i18n";

export function LanguageSwitcher({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const selectorId = useId();
  const pathname = usePathname();
  const router = useRouter();
  const [saving, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = saving || refreshing;
  const [failed, setFailed] = useState(false);

  async function changeLanguage(language: Locale) {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/preferences/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });

      if (!response.ok) {
        throw new Error("Could not update language");
      }

      if (pathname === "/settings") {
        // Refresh the translated Settings content while retaining its form drafts.
        startTransition(() => router.refresh());
        setPending(false);
      } else {
        window.location.reload();
      }
    } catch {
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <div className="language-row">
      <label htmlFor={selectorId}>{label}</label>
      <select
        id={selectorId}
        className="language-select"
        value={locale}
        disabled={pending}
        onChange={(event) => changeLanguage(event.target.value as Locale)}
      >
        <option value="en">EN</option>
        <option value="es">ES</option>
      </select>
      {failed ? <span className="form-error" role="alert">{locale === "es" ? "No se pudo cambiar el idioma. Inténtalo de nuevo." : "Language could not be changed. Please try again."}</span> : null}
    </div>
  );
}
