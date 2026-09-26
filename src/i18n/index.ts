import { cookies, headers } from "next/headers";
import { dictionaries } from "@/i18n/dictionaries";
import { auth } from "@/lib/auth";

export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string | undefined | null): value is Locale {
  return locales.includes(value as Locale);
}

async function getCookieLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get("tattoo-language")?.value;
  return isLocale(value) ? value : "en";
}

export async function getLocale(): Promise<Locale> {
  const cookieLocale = await getCookieLocale();
  const session = await auth.api.getSession({ headers: await headers() });
  const storedLanguage = session?.user.language;
  return isLocale(storedLanguage) ? storedLanguage : cookieLocale;
}

export async function getDictionary() {
  const locale = await getLocale();
  return { locale, dictionary: dictionaries[locale] };
}
