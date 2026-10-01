import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { studioTimeZone } from "@/lib/studio-time";
import { getDictionary } from "@/i18n";

export default async function ClientDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { dictionary, locale } = await getDictionary();
  const { id } = await params;
  const copy = dictionary.clients;

  const client = await prisma.client.findFirst({
    where: { id, artistId },
    include: {
      appointments: {
        where: { artistId },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          startsAt: true,
          status: true,
          designs: {
            where: { design: { artistId } },
            orderBy: [{ isFinal: "desc" }, { design: { createdAt: "desc" } }, { designId: "asc" }],
            take: 1,
            select: { isFinal: true, design: { select: { id: true, title: true } } },
          },
        },
      },
    },
  });

  if (!client) notFound();
  const appointments = client.appointments;

  // Partition the owned records against one request-time snapshot.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isUpcoming = (appointment: (typeof appointments)[number]) =>
    (appointment.status === "PLANNED" || appointment.status === "CONFIRMED") && appointment.startsAt.getTime() >= now;
  const upcoming = appointments.filter(isUpcoming).sort((a, b) =>
    a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const history = appointments.filter(appointment => !isUpcoming(appointment));
  const count = appointments.length;
  const addedDate = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    dateStyle: "medium", timeZone: studioTimeZone,
  }).format(client.createdAt);

  function appointmentRow(appointment: (typeof appointments)[number], next = false) {
    const artwork = appointment.designs[0];
    return (
      <Link className="appointment-history-item data-row" data-artwork={Boolean(artwork)} href={`/appointments/${appointment.id}`} key={appointment.id}>
        {artwork ? <span className="client-artwork-preview">
          {/* Private artwork previews are already optimized by Sharp. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/designs/${artwork.design.id}/image?variant=preview`} alt={artwork.design.title} loading="lazy" />
        </span> : null}
        <div className="client-appointment-main">
          {next ? <span className="client-context-label">{copy.nextAppointment}</span> : null}
          <strong>{artwork?.design.title ?? copy.appointmentRecord}</strong>
          {artwork ? <span className="client-context-label">{artwork.isFinal ? copy.finalArtwork : copy.referenceArtwork}</span> : null}
          <div className="client-appointment-meta">
            <LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} />
            <span className="status-pill" data-status={appointment.status}>{copy.statuses[appointment.status]}</span>
          </div>
        </div>
        <svg className="list-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </Link>
    );
  }

  return (
    <section className="client-page client-record workspace-stack">
      <header className="page-header-row client-record-header">
        <div>
          <Link className="text-link" href="/clients">← {copy.back}</Link>
          <h1 className="page-heading">{client.name}</h1>
        </div>
        <Link className="secondary-button button-link" href={`/clients/${client.id}/edit`}>{copy.edit}</Link>
        <div className="client-contact-actions">
          <a href={`tel:${client.phone}`}><span className="client-context-label">{copy.call}</span>{client.phone}</a>
          {client.email ? <a href={`mailto:${client.email}`}><span className="client-context-label">{copy.email}</span>{client.email}</a> : null}
        </div>
      </header>

      <div className="workspace-split" data-lead="artwork">
        <section className="workspace-section section-intro" aria-labelledby="client-appointments-title">
          <div className="client-history-heading">
            <h2 id="client-appointments-title">{copy.appointments}</h2>
            <span className="client-count">{count} {count === 1 ? copy.appointmentSingular : copy.appointmentPlural}</span>
          </div>
          {count ? (
            <div className="appointment-history client-history">
              {upcoming.length ? <section className="client-history-group" aria-labelledby="client-upcoming-title">
                <h3 id="client-upcoming-title">{copy.upcoming}</h3>
                {upcoming.map((appointment, index) => appointmentRow(appointment, index === 0))}
              </section> : <p className="muted-copy">{copy.noUpcoming}</p>}
              {history.length ? <section className="client-history-group" aria-labelledby="client-history-title">
                <h3 id="client-history-title">{copy.history}</h3>
                {history.map(appointment => appointmentRow(appointment))}
              </section> : null}
            </div>
          ) : <p className="muted-copy">{copy.noAppointments}</p>}
        </section>
        <section className="workspace-section section-intro client-record-notes" aria-labelledby="client-notes-title">
          <h2 id="client-notes-title">{copy.notes}</h2>
          {client.notes ? <p className="prewrap">{client.notes}</p> : <p>{copy.noNotes}</p>}
          <p className="client-added"><span className="client-context-label">{copy.created}</span><time dateTime={client.createdAt.toISOString()}>{addedDate}</time></p>
        </section>
      </div>
    </section>
  );
}
