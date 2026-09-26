import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import {
  cancelAppointment,
  deleteAppointment,
} from "@/app/(app)/appointments/actions";

export default async function AppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const artistId = await requireArtistId();
  const { id } = await params;
  const { locale, dictionary } = await getDictionary();

  const appointment = await prisma.appointment.findFirst({
    where: { id, artistId },
    include: {
      client: true,
      designs: {
        include: { design: true },
        orderBy: [{ isFinal: "desc" }, { design: { createdAt: "desc" } }],
      },
    },
  });

  if (!appointment) notFound();

  const cancelAction = cancelAppointment.bind(null, appointment.id);
  const deleteAction = deleteAppointment.bind(null, appointment.id);

  return (
    <section className="appointment-page">
      <div className="page-title-row appointment-detail-header">
        <div>
          <Link className="back-link" href={`/clients/${appointment.clientId}`}>
            ← {dictionary.appointments.backToClient}
          </Link>
          <h1 className="page-heading">{dictionary.appointments.detailsTitle}</h1>
          <p className="muted-copy">{appointment.client.name}</p>
        </div>
        <Link className="secondary-button button-link" href={`/appointments/${appointment.id}/edit`}>
          {dictionary.appointments.edit}
        </Link>
      </div>

      <div className="appointment-detail-grid">
        <article className="appointment-detail-card">
          <h2>{dictionary.appointments.clientSection}</h2>
          <dl className="detail-list">
            <div>
              <dt>{dictionary.appointments.client}</dt>
              <dd>
                <Link className="detail-link" href={`/clients/${appointment.client.id}`}>
                  {appointment.client.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt>{dictionary.appointments.phone}</dt>
              <dd><a href={`tel:${appointment.client.phone}`}>{appointment.client.phone}</a></dd>
            </div>
          </dl>
        </article>

        <article className="appointment-detail-card">
          <h2>{dictionary.appointments.scheduleSection}</h2>
          <dl className="detail-list">
            <div>
              <dt>{dictionary.appointments.start}</dt>
              <dd><LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} /></dd>
            </div>
            <div>
              <dt>{dictionary.appointments.duration}</dt>
              <dd>{appointment.durationMinutes} {dictionary.appointments.minutes}</dd>
            </div>
            <div>
              <dt>{dictionary.appointments.status}</dt>
              <dd><span className="status-pill">{dictionary.appointments.statuses[appointment.status]}</span></dd>
            </div>
          </dl>
        </article>
      </div>

      <section className="appointment-detail-card appointment-designs-section">
        <h2>{dictionary.appointments.designsSection}</h2>
        <div className="appointment-design-gallery">
          {appointment.designs.map(({ design, isFinal }) => (
            <Link className="appointment-design-card" href={`/designs/${design.id}`} key={design.id}>
              <div className="appointment-design-image-wrap">
                <img
                  src={`/api/designs/${design.id}/image?variant=preview`}
                  alt={design.title}
                  loading="lazy"
                />
                {isFinal ? <span className="final-design-badge">{dictionary.appointments.finalDesign}</span> : null}
              </div>
              <strong>{design.title}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="appointment-detail-card">
        <h2>{dictionary.appointments.notesSection}</h2>
        {appointment.notes ? (
          <p className="prewrap appointment-notes">{appointment.notes}</p>
        ) : (
          <p className="muted-copy">{dictionary.appointments.noNotes}</p>
        )}
      </section>

      <section className="appointment-actions-section">
        {appointment.status !== "CANCELLED" ? (
          <form action={cancelAction}>
            <button className="secondary-button" type="submit">
              {dictionary.appointments.cancelAppointment}
            </button>
          </form>
        ) : null}
        <form action={deleteAction}>
          <button className="danger-button" type="submit">
            {dictionary.appointments.deleteAppointment}
          </button>
        </form>
      </section>
    </section>
  );
}
