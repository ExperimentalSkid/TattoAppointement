import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { dictionaries } from "@/i18n/dictionaries";
import { getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export default async function ProtectedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const dictionary = dictionaries[locale];
  const artist = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, studioName: true },
  });

  return (
    <AppShell
      dictionary={dictionary}
      locale={locale}
      userName={artist.name}
      studioName={artist.studioName}
    >
      {children}
    </AppShell>
  );
}
