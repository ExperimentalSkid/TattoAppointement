import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";

export default async function ClientDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { dictionary, locale } = await getDictionary();
  const { id } = await params;

  const client = await prisma.client.findFirst({
    where: { id, artistId },
    include: {
      appointments: {
        where: { artistId },
        orderBy: { startsAt: "desc" },
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          status: true,
        },
      },
    },
  });

  if (!client) notFound();

  return (
    <section className="client-page workspace-stack">
      <div className="page-header-row">
        <div>
          <Link className="text-link" href="/clients">← {dictionary.clients.back}</Link>
          <h1 className="page-heading">{client.name}</h1>
        </div>
        <Link className="secondary-button button-link" href={`/clients/${client.id}/edit`}>
          {dictionary.clients.edit}
        </Link>
      </div>

      <div className="client-detail-grid workspace-split">
        <article className="client-panel workspace-section section-intro">
          <h2>{dictionary.clients.details}</h2>
          <dl className="client-details-list">
            <div>
              <dt>{dictionary.clients.phone}</dt>
              <dd><a href={`tel:${client.phone}`}>{client.phone}</a></dd>
            </div>
            {client.email ? (
              <div>
                <dt>{dictionary.clients.email}</dt>
                <dd><a href={`mailto:${client.email}`}>{client.email}</a></dd>
              </div>
            ) : null}
            {client.notes ? (
              <div>
                <dt>{dictionary.clients.notes}</dt>
                <dd className="prewrap">{client.notes}</dd>
              </div>
            ) : null}
            <div>
              <dt>{dictionary.clients.created}</dt>
              <dd>{new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", { dateStyle: "medium" }).format(client.createdAt)}</dd>
            </div>
          </dl>
        </article>

        <article className="client-panel workspace-section section-intro">
          <h2>{dictionary.clients.appointments}</h2>
          {client.appointments.length ? (
            <div className="appointment-history">
              {client.appointments.map((appointment) => (
                <Link
                  className="appointment-history-item data-row"
                  href={`/appointments/${appointment.id}`}
                  key={appointment.id}
                >
                  <div>
                    <strong>
                      <LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} />
                    </strong>
                    <span>{appointment.durationMinutes} {dictionary.clients.minutes}</span>
                  </div>
                  <span className="status-pill" data-status={appointment.status}>
                    {dictionary.clients.statuses[appointment.status]}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted-copy">{dictionary.clients.noAppointments}</p>
          )}
        </article>
      </div>
    </section>
  );
}
