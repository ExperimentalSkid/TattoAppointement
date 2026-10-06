import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { dictionaries } from "@/i18n/dictionaries";
import { getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWorkspaceRevision } from "@/lib/workspace-sync";
import { isTintaAdminIdentity } from "@/lib/beta-access";

export default async function ProtectedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const dictionary = dictionaries[locale];
  const [artist, syncRevision] = await Promise.all([prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, studioName: true, diagnosticsConsent: true },
  }), getWorkspaceRevision(session.user.id)]);

  return (
    <AppShell
      key={session.user.id}
      dictionary={dictionary}
      locale={locale}
      userName={artist.name}
      studioName={artist.studioName}
      syncRevision={syncRevision}
      workspaceId={session.user.id}
      diagnosticsConsent={artist.diagnosticsConsent}
      isTintaAdmin={isTintaAdminIdentity(session.user)}
    >
      {children}
    </AppShell>
  );
}
