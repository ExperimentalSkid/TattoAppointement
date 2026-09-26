import { AppointmentForm } from "@/components/appointment-form";
import { getDictionary } from "@/i18n";
import { appointmentCopy } from "@/i18n/appointment-copy";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";

export default async function NewAppointmentPage() {
  const artistId = await requireArtistId();
  const { locale } = await getDictionary();

  const [clients, designs] = await Promise.all([
    prisma.client.findMany({
      where: { artistId },
      orderBy: { name: "asc" },
      take: 300,
      select: { id: true, name: true, phone: true },
    }),
    prisma.design.findMany({
      where: { artistId },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: { id: true, title: true },
    }),
  ]);

  return (
    <AppointmentForm
      copy={appointmentCopy[locale]}
      initialClients={clients}
      designs={designs.map((design) => ({
        ...design,
        thumbUrl: `/api/designs/${design.id}/image?variant=thumb`,
      }))}
    />
  );
}
