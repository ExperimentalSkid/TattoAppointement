import { cookies } from "next/headers";
import { dictionaries } from "@/i18n/dictionaries";

export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string | undefined | null): value is Locale {
  return locales.includes(value as Locale);
}

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get("tattoo-language")?.value;
  return isLocale(value) ? value : "en";
}

export async function getDictionary() {
  const locale = await getLocale();
  return { locale, dictionary: dictionaries[locale] };
}
