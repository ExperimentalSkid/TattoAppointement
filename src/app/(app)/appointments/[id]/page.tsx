import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LocalDateTime } from "@/components/local-date-time";
import { PaymentForm } from "@/components/payment-form";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { cancelAppointment, deleteAppointment } from "@/app/(app)/appointments/actions";
import { deletePayment, recordPayment } from "@/app/(app)/appointments/payment-actions";
import { calculateMoneySummary, decimalToCents, formatEuro } from "@/lib/money";

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

  const formatMoney = (cents: number | null) => formatEuro(cents, locale);
  const removePaymentLabel = locale === "es" ? "Eliminar pago" : "Remove payment";
  const deleteAppointmentConfirmation = locale === "es"
    ? "¿Eliminar esta cita y su historial de pagos?"
    : "Delete this appointment and its payment history?";

  return (
    <section className="appointment-page workspace-stack">
      <div className="page-title-row appointment-detail-header">
        <div>
          <Link className="back-link" href={`/clients/${appointment.clientId}`}>← {dictionary.appointments.backToClient}</Link>
          <p className="eyebrow">{dictionary.appointments.detailsTitle}</p>
          <h1 className="page-heading">{appointment.client.name}</h1>
          <p className="muted-copy"><LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} /></p>
        </div>
        <Link className="secondary-button button-link" href={`/appointments/${appointment.id}/edit`}>{dictionary.appointments.edit}</Link>
      </div>

      <div className="workspace-split" data-lead="artwork">
        <div className="workspace-stack">
          <section className="appointment-detail-card appointment-designs-section workspace-section section-intro">
            <h2>{dictionary.appointments.designsSection}</h2>
            <div className="appointment-design-gallery">
              {appointment.designs.map(({ design, isFinal }) => (
                <Link className="appointment-design-card artwork-object" href={`/designs/${design.id}`} key={design.id}>
                  <div className="appointment-design-image-wrap">
                    {/* Authenticated previews are already optimized by Sharp. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/designs/${design.id}/image?variant=preview`} alt={design.title} loading="lazy" />
                  </div>
                  <strong>{design.title}</strong>
                  {isFinal ? <span className="final-design-badge">✓ {dictionary.appointments.finalDesign}</span> : null}
                </Link>
              ))}
            </div>
          </section>
          <section className="appointment-detail-card workspace-section section-intro">
            <h2>{dictionary.appointments.notesSection}</h2>
            {appointment.notes ? <p className="prewrap appointment-notes">{appointment.notes}</p> : <p className="muted-copy">{dictionary.appointments.noNotes}</p>}
          </section>
        </div>
        <aside className="workspace-stack">
        <article className="appointment-detail-card workspace-section section-intro">
          <h2>{dictionary.appointments.clientSection}</h2>
          <dl className="detail-list">
            <div><dt>{dictionary.appointments.client}</dt><dd><Link className="detail-link" href={`/clients/${appointment.client.id}`}>{appointment.client.name}</Link></dd></div>
            <div><dt>{dictionary.appointments.phone}</dt><dd><a href={`tel:${appointment.client.phone}`}>{appointment.client.phone}</a></dd></div>
          </dl>
        </article>

        <article className="appointment-detail-card workspace-section section-intro">
          <h2>{dictionary.appointments.scheduleSection}</h2>
          <dl className="detail-list">
            <div><dt>{dictionary.appointments.start}</dt><dd><LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} /></dd></div>
            <div><dt>{dictionary.appointments.status}</dt><dd><span className="status-pill" data-status={appointment.status}>{dictionary.appointments.statuses[appointment.status]}</span></dd></div>
          </dl>
        </article>
        </aside>
      </div>

      <section className="appointment-detail-card money-section workspace-section section-intro">
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
              {appointment.payments.map((payment) => {
                const paymentAmount = formatMoney(decimalToCents(payment.amount));
                const deletePaymentAction = deletePayment.bind(null, payment.id, appointment.id);
                const removePaymentConfirmation = locale === "es"
                  ? `¿Eliminar el pago registrado de ${paymentAmount}?`
                  : `Remove the recorded payment of ${paymentAmount}?`;

                return (
                  <li key={payment.id}>
                    <div className="payment-history-entry">
                      <strong>{paymentAmount}</strong>
                      <LocalDateTime iso={payment.receivedAt.toISOString()} locale={locale} />
                    </div>
                    <form action={deletePaymentAction}>
                      <ConfirmSubmitButton
                        className="secondary-button payment-remove-button"
                        message={removePaymentConfirmation}
                      >
                        {removePaymentLabel}
                      </ConfirmSubmitButton>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted-copy">{dictionary.appointments.noPayments}</p>}
        </div>
      </section>

      <section className="appointment-actions-section">
        {appointment.status !== "CANCELLED" ? <form action={cancelAction}><button className="secondary-button" type="submit">{dictionary.appointments.cancelAppointment}</button></form> : null}
        <form action={deleteAction}>
          <ConfirmSubmitButton className="danger-button" message={deleteAppointmentConfirmation}>
            {dictionary.appointments.deleteAppointment}
          </ConfirmSubmitButton>
        </form>
      </section>
    </section>
  );
}
