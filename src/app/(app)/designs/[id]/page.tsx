import Link from "next/link";
import { notFound } from "next/navigation";
import { DesignImageViewer } from "@/components/design-image-viewer";
import { LocalDateTime } from "@/components/local-date-time";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { designDetailPath, designLibraryPath, normalizeDesignQuery } from "@/lib/design-navigation";
import { studioTimeZone } from "@/lib/studio-time";

function formatBytes(value: number | null, locale: string) {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MB`;
}

export default async function DesignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ libraryQuery?: string | string[] }>;
}) {
  const artistId = await requireArtistId();
  const { id } = await params;
  const { locale, dictionary } = await getDictionary();
  const libraryQuery = normalizeDesignQuery((await searchParams).libraryQuery);

  const design = await prisma.design.findFirst({
    where: { id, artistId },
    include: {
      appointments: {
        where: { appointment: { artistId, client: { artistId } } },
        select: {
          isFinal: true,
          appointment: {
            select: {
              id: true,
              startsAt: true,
              status: true,
              client: { select: { name: true } },
            },
          },
        },
        orderBy: [{ appointment: { startsAt: "desc" } }, { appointmentId: "asc" }],
      },
    },
  });

  if (!design) notFound();

  const localeName = locale === "es" ? "es-ES" : "en-GB";
  const dateFormatter = new Intl.DateTimeFormat(localeName, { dateStyle: "medium", timeZone: studioTimeZone });
  const linkedAppointments = design.appointments;
  // Evaluate both groups against the same authenticated request time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isUpcoming = ({ appointment }: (typeof linkedAppointments)[number]) =>
    (appointment.status === "PLANNED" || appointment.status === "CONFIRMED") && appointment.startsAt.getTime() >= now;
  const upcoming = linkedAppointments.filter(isUpcoming).sort((a, b) =>
    a.appointment.startsAt.getTime() - b.appointment.startsAt.getTime() || a.appointment.id.localeCompare(b.appointment.id));
  const history = linkedAppointments.filter(entry => !isUpcoming(entry));
  const count = linkedAppointments.length;

  function appointmentRow({ appointment, isFinal }: (typeof linkedAppointments)[number]) {
    return (
      <Link className="history-row data-row" href={`/appointments/${appointment.id}`} key={appointment.id}>
        <div>
          <strong>{appointment.client.name}</strong>
          <span className="client-context-label">{isFinal ? dictionary.clients.finalArtwork : dictionary.clients.referenceArtwork}</span>
          <span><LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} /></span>
        </div>
        <span className="status-pill" data-status={appointment.status}>{dictionary.clients.statuses[appointment.status]}</span>
        <svg className="list-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </Link>
    );
  }

  return (
    <section className="workspace-stack">
      <div className="page-title-row">
        <div>
          <Link className="back-link" href={designLibraryPath(libraryQuery)}>
            ← {dictionary.designs.back}
          </Link>
          <h1 className="page-heading">{design.title}</h1>
        </div>
        <Link className="secondary-button button-link" href={designDetailPath(design.id, libraryQuery, true)}>
          {dictionary.designs.edit}
        </Link>
      </div>

      <div className="design-detail-grid workspace-split" data-lead="artwork">
        <DesignImageViewer designId={design.id} title={design.title} copy={dictionary.designs} />

        <div className="detail-card workspace-section">
          <dl className="detail-list">
            <div>
              <dt>{dictionary.designs.added}</dt>
              <dd><time dateTime={design.createdAt.toISOString()}>{dateFormatter.format(design.createdAt)}</time></dd>
            </div>
            <div>
              <dt>{dictionary.designs.originalFile}</dt>
              <dd>{design.originalName ?? "—"}</dd>
            </div>
            <div>
              <dt>{dictionary.designs.fileSize}</dt>
              <dd>{formatBytes(design.fileSize, localeName)}</dd>
            </div>
          </dl>
          {design.notes ? <p className="detail-notes">{design.notes}</p> : null}
        </div>
      </div>

      <section className="history-section workspace-section section-intro design-history">
        <div className="client-history-heading">
          <h2>{dictionary.designs.appointments}</h2>
          <span className="client-count">{count} {count === 1 ? dictionary.clients.appointmentSingular : dictionary.clients.appointmentPlural}</span>
        </div>
        {count ? (
          <div className="appointment-history record-history">
            {upcoming.length ? <section className="record-history-group" aria-labelledby="design-upcoming-title">
              <h3 id="design-upcoming-title">{dictionary.clients.upcoming}</h3>
              {upcoming.map(appointmentRow)}
            </section> : <p className="muted-copy">{dictionary.clients.noUpcoming}</p>}
            {history.length ? <section className="record-history-group" aria-labelledby="design-history-title">
              <h3 id="design-history-title">{dictionary.clients.history}</h3>
              {history.map(appointmentRow)}
            </section> : null}
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <p>{dictionary.designs.noAppointments}</p>
          </div>
        )}
      </section>
    </section>
  );
}
