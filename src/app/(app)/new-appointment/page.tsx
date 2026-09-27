import { AppointmentForm } from "@/components/appointment-form";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { createAppointment } from "@/app/(app)/appointments/actions";

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string | string[] }>;
}) {
  const artistId = await requireArtistId();
  const { dictionary } = await getDictionary();
  const params = await searchParams;
  const requestedClientId = typeof params.clientId === "string" ? params.clientId : "";

  const [clients, designs] = await Promise.all([
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

  const defaultClientId = clients.some((client) => client.id === requestedClientId)
    ? requestedClientId
    : undefined;

  return (
    <section className="appointment-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-heading">{dictionary.pages.newAppointmentTitle}</h1>
          <p className="muted-copy">{dictionary.appointments.createIntro}</p>
        </div>
      </div>

      <AppointmentForm
        action={createAppointment}
        clients={clients}
        designs={designs}
        copy={dictionary.appointments}
        defaultClientId={defaultClientId}
      />
    </section>
  );
}
