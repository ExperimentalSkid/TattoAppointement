import { ClientManager } from "@/components/client-manager";
import { getDictionary } from "@/i18n";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";

export default async function ClientsPage() {
  const artistId = await requireArtistId();
  const { dictionary, locale } = await getDictionary();

  const clients = await prisma.client.findMany({
    where: { artistId },
    orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      updatedAt: true,
      _count: {
        select: { appointments: true },
      },
    },
  });

  return (
    <ClientManager
      locale={locale}
      copy={dictionary.clients}
      initialClients={clients.map(({ _count, updatedAt, ...client }) => ({
        ...client,
        updatedAt: updatedAt.toISOString(),
        appointmentCount: _count.appointments,
      }))}
    />
  );
}
