import Link from "next/link";
import { notFound } from "next/navigation";
import { DesignImageViewer } from "@/components/design-image-viewer";
import { LocalDateTime } from "@/components/local-date-time";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";

function formatBytes(value: number | null, locale: string) {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MB`;
}

export default async function DesignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { id } = await params;
  const { locale, dictionary } = await getDictionary();

  const design = await prisma.design.findFirst({
    where: { id, artistId },
    include: {
      appointments: {
        include: {
          appointment: {
            include: {
              client: { select: { name: true } },
            },
          },
        },
        orderBy: { appointment: { startsAt: "desc" } },
      },
    },
  });

  if (!design) notFound();

  const localeName = locale === "es" ? "es-ES" : "en-GB";
  const dateFormatter = new Intl.DateTimeFormat(localeName, { dateStyle: "medium" });

  return (
    <section>
      <div className="page-title-row">
        <div>
          <Link className="back-link" href="/designs">
            ← {dictionary.designs.back}
          </Link>
          <h1 className="page-heading">{design.title}</h1>
        </div>
        <Link className="secondary-button button-link" href={`/designs/${design.id}/edit`}>
          {dictionary.designs.edit}
        </Link>
      </div>

      <div className="design-detail-grid">
        <DesignImageViewer designId={design.id} title={design.title} copy={dictionary.designs} />

        <div className="detail-card">
          <dl className="detail-list">
            <div>
              <dt>{dictionary.designs.added}</dt>
              <dd>{dateFormatter.format(design.createdAt)}</dd>
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

      <section className="history-section">
        <h2>{dictionary.designs.appointments}</h2>
        {design.appointments.length ? (
          <div className="appointment-history">
            {design.appointments.map(({ appointment, isFinal }) => (
              <Link
                className="history-row"
                href={`/appointments/${appointment.id}`}
                key={appointment.id}
              >
                <div>
                  <strong>{appointment.client.name}</strong>
                  <span>
                    <LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} />
                  </span>
                </div>
                <span>{dictionary.clients.statuses[appointment.status]}</span>
                {isFinal ? <strong>✓</strong> : null}
              </Link>
            ))}
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
