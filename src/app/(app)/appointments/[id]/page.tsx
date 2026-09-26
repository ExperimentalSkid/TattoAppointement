import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { PaymentForm } from "@/components/payment-form";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { cancelAppointment, deleteAppointment } from "@/app/(app)/appointments/actions";
import { recordPayment } from "@/app/(app)/appointments/payment-actions";
import { calculateMoneySummary, centsToDecimal, decimalToCents } from "@/lib/money";

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
      payments: { orderBy: { receivedAt: "desc" } },
    },
  });

  if (!appointment) notFound();

  const cancelAction = cancelAppointment.bind(null, appointment.id);
  const deleteAction = deleteAppointment.bind(null, appointment.id);
  const paymentAction = recordPayment.bind(null, appointment.id);
  const agreedPriceCents = decimalToCents(appointment.agreedPrice);
  const depositRequiredCents = decimalToCents(appointment.depositRequired) ?? 0;
  const paymentCents = appointment.payments.map((payment) => decimalToCents(payment.amount) ?? 0);
  const money = calculateMoneySummary({ agreedPriceCents, depositRequiredCents, paymentsCents: paymentCents });

  const formatMoney = (cents: number | null) => cents === null ? "—" : centsToDecimal(cents);

  return (
    <section className="appointment-page">
      <div className="page-title-row appointment-detail-header">
        <div>
          <Link className="back-link" href={`/clients/${appointment.clientId}`}>← {dictionary.appointments.backToClient}</Link>
          <h1 className="page-heading">{dictionary.appointments.detailsTitle}</h1>
          <p className="muted-copy">{appointment.client.name}</p>
        </div>
        <Link className="secondary-button button-link" href={`/appointments/${appointment.id}/edit`}>{dictionary.appointments.edit}</Link>
      </div>

      <div className="appointment-detail-grid">
        <article className="appointment-detail-card">
          <h2>{dictionary.appointments.clientSection}</h2>
          <dl className="detail-list">
            <div><dt>{dictionary.appointments.client}</dt><dd><Link className="detail-link" href={`/clients/${appointment.client.id}`}>{appointment.client.name}</Link></dd></div>
            <div><dt>{dictionary.appointments.phone}</dt><dd><a href={`tel:${appointment.client.phone}`}>{appointment.client.phone}</a></dd></div>
          </dl>
        </article>

        <article className="appointment-detail-card">
          <h2>{dictionary.appointments.scheduleSection}</h2>
          <dl className="detail-list">
            <div><dt>{dictionary.appointments.start}</dt><dd><LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} /></dd></div>
            <div><dt>{dictionary.appointments.duration}</dt><dd>{appointment.durationMinutes} {dictionary.appointments.minutes}</dd></div>
            <div><dt>{dictionary.appointments.status}</dt><dd><span className="status-pill">{dictionary.appointments.statuses[appointment.status]}</span></dd></div>
          </dl>
        </article>
      </div>

      <section className="appointment-detail-card appointment-designs-section">
        <h2>{dictionary.appointments.designsSection}</h2>
        <div className="appointment-design-gallery">
          {appointment.designs.map(({ design, isFinal }) => (
            <Link className="appointment-design-card" href={`/designs/${design.id}`} key={design.id}>
              <div className="appointment-design-image-wrap">
                <img src={`/api/designs/${design.id}/image?variant=preview`} alt={design.title} loading="lazy" />
                {isFinal ? <span className="final-design-badge">{dictionary.appointments.finalDesign}</span> : null}
              </div>
              <strong>{design.title}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="appointment-detail-card">
        <h2>{dictionary.appointments.notesSection}</h2>
        {appointment.notes ? <p className="prewrap appointment-notes">{appointment.notes}</p> : <p className="muted-copy">{dictionary.appointments.noNotes}</p>}
      </section>

      <section className="appointment-detail-card money-section">
        <div className="section-heading-row">
          <div>
            <h2>{dictionary.appointments.moneySection}</h2>
            <p className="muted-copy">{dictionary.appointments.paymentStates[money.paymentState]} · {dictionary.appointments.depositStates[money.depositState]}</p>
          </div>
        </div>
        <dl className="money-summary-grid">
          <div><dt>{dictionary.appointments.agreedPrice}</dt><dd>{formatMoney(agreedPriceCents)}</dd></div>
          <div><dt>{dictionary.appointments.depositRequired}</dt><dd>{formatMoney(depositRequiredCents)}</dd></div>
          <div><dt>{dictionary.appointments.amountReceived}</dt><dd>{formatMoney(money.totalReceivedCents)}</dd></div>
          <div><dt>{dictionary.appointments.depositRemaining}</dt><dd>{formatMoney(money.depositPendingCents)}</dd></div>
          <div><dt>{dictionary.appointments.remainingBalance}</dt><dd>{formatMoney(money.remainingTotalCents)}</dd></div>
          <div><dt>{dictionary.appointments.depositStatus}</dt><dd>{dictionary.appointments.depositStates[money.depositState]}</dd></div>
          <div><dt>{dictionary.appointments.paymentStatus}</dt><dd>{dictionary.appointments.paymentStates[money.paymentState]}</dd></div>
        </dl>

        <PaymentForm action={paymentAction} copy={dictionary.appointments} />

        <div className="payment-history">
          <h3>{dictionary.appointments.paymentHistory}</h3>
          {appointment.payments.length ? (
            <ul className="payment-history-list">
              {appointment.payments.map((payment) => (
                <li key={payment.id}>
                  <strong>{formatMoney(decimalToCents(payment.amount))}</strong>
                  <LocalDateTime iso={payment.receivedAt.toISOString()} locale={locale} />
                </li>
              ))}
            </ul>
          ) : <p className="muted-copy">{dictionary.appointments.noPayments}</p>}
        </div>
      </section>

      <section className="appointment-actions-section">
        {appointment.status !== "CANCELLED" ? <form action={cancelAction}><button className="secondary-button" type="submit">{dictionary.appointments.cancelAppointment}</button></form> : null}
        <form action={deleteAction}><button className="danger-button" type="submit">{dictionary.appointments.deleteAppointment}</button></form>
      </section>
    </section>
  );
}
