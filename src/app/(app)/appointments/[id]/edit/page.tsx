import { notFound } from "next/navigation";
import { AppointmentForm } from "@/components/appointment-form";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { updateAppointment } from "@/app/(app)/appointments/actions";
import type { AppointmentStatusValue } from "@/lib/appointments";

export default async function EditAppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { id } = await params;
  const { dictionary } = await getDictionary();

  const [appointment, clients, designs] = await Promise.all([
    prisma.appointment.findFirst({
      where: { id, artistId },
      include: { designs: { select: { designId: true, isFinal: true } } },
    }),
    prisma.client.findMany({
      where: { artistId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
    prisma.design.findMany({
      where: { artistId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
  ]);

  if (!appointment) notFound();

  const action = updateAppointment.bind(null, appointment.id);
  const finalDesign = appointment.designs.find((item) => item.isFinal);

  return (
    <section className="appointment-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-heading">{dictionary.appointments.editTitle}</h1>
          <p className="muted-copy">{dictionary.appointments.editIntro}</p>
        </div>
      </div>

      <AppointmentForm
        action={action}
        clients={clients}
        designs={designs}
        copy={dictionary.appointments}
        cancelHref={`/appointments/${appointment.id}`}
        initial={{
          clientId: appointment.clientId,
          startsAtIso: appointment.startsAt.toISOString(),
          durationMinutes: appointment.durationMinutes,
          notes: appointment.notes,
          status: appointment.status as AppointmentStatusValue,
          designIds: appointment.designs.map((item) => item.designId),
          finalDesignId: finalDesign?.designId ?? null,
          agreedPrice: appointment.agreedPrice?.toString() ?? null,
          depositRequired: appointment.depositRequired.toString(),
        }}
      />
    </section>
  );
}
