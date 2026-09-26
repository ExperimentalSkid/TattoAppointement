"use client";

export function LocalDateTime({ iso, locale }: { iso: string; locale: "en" | "es" }) {
  const formatted = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
