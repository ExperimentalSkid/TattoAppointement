import { notFound } from "next/navigation";
import { AppointmentForm } from "@/components/appointment-form";
import { getDictionary } from "@/i18n";
import { appointmentCopy } from "@/i18n/appointment-copy";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";

export default async function AppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { id } = await params;
  const { locale } = await getDictionary();

  const [appointment, clients, designs] = await Promise.all([
    prisma.appointment.findFirst({
      where: { id, artistId },
      select: {
        id: true,
        clientId: true,
        startsAt: true,
        durationMinutes: true,
        notes: true,
        status: true,
        designs: {
          select: { designId: true, isFinal: true },
        },
      },
    }),
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

  if (!appointment) notFound();

  return (
    <AppointmentForm
      copy={appointmentCopy[locale]}
      initialClients={clients}
      designs={designs.map((design) => ({
        ...design,
        thumbUrl: `/api/designs/${design.id}/image?variant=thumb`,
      }))}
      appointment={{
        id: appointment.id,
        clientId: appointment.clientId,
        startsAt: appointment.startsAt.toISOString(),
        durationMinutes: appointment.durationMinutes,
        notes: appointment.notes,
        status: appointment.status,
        designIds: appointment.designs.map((item) => item.designId),
        finalDesignId: appointment.designs.find((item) => item.isFinal)?.designId ?? null,
      }}
    />
  );
}
