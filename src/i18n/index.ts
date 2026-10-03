import { cookies } from "next/headers";
import { dictionaries } from "@/i18n/dictionaries";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];

export function isLocale(value: string | undefined | null): value is Locale {
  return locales.includes(value as Locale);
}

async function getCookieLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get("tattoo-language")?.value;
  return isLocale(value) ? value : "es";
}

export async function getLocale(): Promise<Locale> {
  const session = await getSession();

  if (session?.user.id) {
    const artist = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { language: true },
    });

    if (isLocale(artist?.language)) {
      return artist.language;
    }
  }

  return getCookieLocale();
}

export async function getDictionary() {
  const locale = await getLocale();
  return { locale, dictionary: dictionaries[locale] };
}
