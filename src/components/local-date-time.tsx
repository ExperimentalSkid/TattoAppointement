"use client";

import { useEffect, useState } from "react";

export function LocalDateTime({ iso, locale }: { iso: string; locale: "en" | "es" }) {
  const [formatted, setFormatted] = useState("");

  useEffect(() => {
    const value = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
    setFormatted(value);
  }, [iso, locale]);

  return <time dateTime={iso}>{formatted || "…"}</time>;
}
