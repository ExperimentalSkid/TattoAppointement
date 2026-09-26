import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { dictionaries } from "@/i18n/dictionaries";
import { getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";

export default async function ProtectedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const dictionary = dictionaries[locale];

  return (
    <AppShell
      dictionary={dictionary}
      locale={locale}
      userName={session.user.name}
    >
      {children}
    </AppShell>
  );
}
