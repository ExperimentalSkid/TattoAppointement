"use client";

import { useId, useState } from "react";
import type { Locale } from "@/i18n";

export function LanguageSwitcher({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  const selectorId = useId();
  const [pending, setPending] = useState(false);

  async function changeLanguage(language: Locale) {
    setPending(true);
    try {
      const response = await fetch("/api/preferences/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });

      if (!response.ok) {
        throw new Error("Could not update language");
      }

      window.location.reload();
    } catch (error) {
      setPending(false);
      throw error;
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
    </div>
  );
}
