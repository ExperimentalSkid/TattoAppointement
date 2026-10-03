import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LocalDateTime } from "@/components/local-date-time";
import { PaymentForm } from "@/components/payment-form";
import { AppointmentRescheduleForm } from "@/components/appointment-reschedule-form";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { cancelAppointment, deleteAppointment, rescheduleAppointment } from "@/app/(app)/appointments/actions";
import { deletePayment, recordPayment } from "@/app/(app)/appointments/payment-actions";
import { calculateMoneySummary, decimalToCents, formatEuro } from "@/lib/money";
import { studioTimeZone } from "@/lib/studio-time";
import { getDefaultReminderTemplate, getWhatsAppReminderUrl, renderReminderTemplate } from "@/lib/whatsapp-reminder";

export default async function AppointmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reschedule?: string | string[] }>;
}) {
  const artistId = await requireArtistId();
  const { id } = await params;
  const { reschedule } = await searchParams;
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

  const artist = await prisma.user.findUnique({
    where: { id: artistId },
    select: { name: true, studioName: true, whatsappReminderTemplate: true },
  });
  // This authenticated server page evaluates eligibility at the time of the request.
  // eslint-disable-next-line react-hooks/purity
  const isUpcoming = appointment.startsAt.getTime() > Date.now();
  const canSendReminder = isUpcoming && (appointment.status === "PLANNED" || appointment.status === "CONFIRMED");
  const reminderLocale = locale === "es" ? "es-ES" : "en-GB";
  const reminderMessage = renderReminderTemplate(
    artist?.whatsappReminderTemplate ?? getDefaultReminderTemplate(locale),
    {
      client: appointment.client.name,
      date: new Intl.DateTimeFormat(reminderLocale, { dateStyle: "long", timeZone: studioTimeZone }).format(appointment.startsAt),
      time: new Intl.DateTimeFormat(reminderLocale, { timeStyle: "short", timeZone: studioTimeZone }).format(appointment.startsAt),
      studio: artist?.studioName || artist?.name || "",
    },
  );
  const reminderUrl = canSendReminder ? getWhatsAppReminderUrl(appointment.client.phone, reminderMessage) : null;
  const isActive = appointment.status === "PLANNED" || appointment.status === "CONFIRMED";
  const isHistoricalOutcome = appointment.status === "CANCELLED" || appointment.status === "NO_SHOW";

  const cancelAction = cancelAppointment.bind(null, appointment.id);
  const deleteAction = deleteAppointment.bind(null, appointment.id);
  const rescheduleAction = rescheduleAppointment.bind(null, appointment.id);
  const paymentAction = recordPayment.bind(null, appointment.id);
  const agreedPriceCents = decimalToCents(appointment.agreedPrice);
  const depositRequiredCents = decimalToCents(appointment.depositRequired) ?? 0;
  const paymentCents = appointment.payments.map((payment) => decimalToCents(payment.amount) ?? 0);
  const money = calculateMoneySummary({ agreedPriceCents, depositRequiredCents, paymentsCents: paymentCents });
  const historicalDifferenceCents = agreedPriceCents === null ? null : agreedPriceCents - money.totalReceivedCents;

  const formatMoney = (cents: number | null) => cents !== null && cents < 0
    ? `-${formatEuro(-cents, locale)}`
    : formatEuro(cents, locale);
  const removePaymentLabel = locale === "es" ? "Eliminar pago" : "Remove payment";

  return (
    <section className="appointment-page workspace-stack">
      <header className="appointment-detail-header">
        <div>
          <Link className="back-link" href={`/clients/${appointment.clientId}`}>← {dictionary.appointments.backToClient}</Link>
          <p className="eyebrow">{dictionary.appointments.detailsTitle}</p>
          <h1 className="page-heading">{appointment.client.name}</h1>
          <div className="appointment-record-meta">
            <LocalDateTime iso={appointment.startsAt.toISOString()} locale={locale} />
            <span className="status-pill" data-status={appointment.status}>{dictionary.appointments.statuses[appointment.status]}</span>
            <a href={`tel:${appointment.client.phone}`}>{appointment.client.phone}</a>
          </div>
        </div>
        <div className="appointment-record-actions">
          <Link className="secondary-button button-link" href={`/appointments/${appointment.id}/edit`}>{dictionary.appointments.edit}</Link>
          <AppointmentRescheduleForm key={`${appointment.id}-${reschedule === "1"}`} action={rescheduleAction} appointmentId={appointment.id} startsAtIso={appointment.startsAt.toISOString()} expectedVersion={appointment.updatedAt.toISOString()} isActive={isActive} copy={dictionary.appointments} locale={locale} initialExpanded={reschedule === "1"} />
          {reminderUrl ? <a className="secondary-button button-link" href={reminderUrl} target="_blank" rel="noopener noreferrer">{locale === "es" ? "Preparar recordatorio por WhatsApp" : "Prepare WhatsApp reminder"}</a> : null}
          {canSendReminder ? <p className="appointment-reminder-help muted-copy">{reminderUrl
            ? locale === "es" ? "Revisa el mensaje en WhatsApp y pulsa Enviar." : "Review the message in WhatsApp and press Send."
            : locale === "es" ? "Para usar WhatsApp, añade un teléfono válido con prefijo internacional o un número español de 9 cifras." : "To use WhatsApp, add a valid phone number with its country code or a 9-digit Spanish number."}</p> : null}
        </div>
      </header>

      <div className="workspace-split" data-lead="artwork">
          <section className="appointment-detail-card appointment-designs-section workspace-section section-intro">
            <h2>{dictionary.appointments.designsSection}</h2>
            {appointment.designs.length ? <div className="appointment-design-gallery">
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
            </div> : <div className="appointment-artwork-empty">
              <p className="muted-copy">{dictionary.appointments.noArtworkAttached}</p>
              <Link className="text-link" href={`/appointments/${appointment.id}/edit#appointment-designs`}>{dictionary.appointments.addArtwork}</Link>
            </div>}
          </section>
          <section className="appointment-detail-card workspace-section section-intro">
            <h2>{dictionary.appointments.notesSection}</h2>
            {appointment.notes ? <p className="prewrap appointment-notes">{appointment.notes}</p> : <p className="muted-copy">{dictionary.appointments.noNotes}</p>}
          </section>
      </div>

      <section className="appointment-detail-card money-section workspace-section section-intro">
        <div className="section-heading-row">
          <div>
            <h2>{dictionary.appointments.moneySection}</h2>
            <p className="muted-copy">{isHistoricalOutcome ? dictionary.appointments.historicalPaymentSummary : dictionary.appointments.paymentStates[money.paymentState]}</p>
          </div>
          <Link className="text-link compact-link" href={`/appointments/${appointment.id}/edit?section=money#appointment-money`}>{dictionary.appointments.editMoney}</Link>
        </div>
        <dl className="money-summary-grid appointment-money-overview">
          <div><dt>{dictionary.appointments.agreedPrice}</dt><dd>{formatMoney(agreedPriceCents)}</dd></div>
          <div><dt>{dictionary.appointments.amountReceived}</dt><dd>{formatMoney(money.totalReceivedCents)}</dd></div>
          <div><dt>{isHistoricalOutcome ? dictionary.appointments.historicalBalance : dictionary.appointments.remainingBalance}</dt><dd>{formatMoney(isHistoricalOutcome ? historicalDifferenceCents : money.remainingTotalCents)}</dd></div>
        </dl>
        <p className="appointment-deposit-summary">
          {depositRequiredCents > 0 ? <>
            <span>{dictionary.appointments.depositRequired}: {formatMoney(depositRequiredCents)}</span>
            {!isHistoricalOutcome ? <span>{money.depositPendingCents > 0 ? `${dictionary.appointments.depositRemaining}: ${formatMoney(money.depositPendingCents)}` : dictionary.appointments.depositStates.PAID}</span> : null}
          </> : dictionary.appointments.depositStates.NOT_REQUIRED}
        </p>

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

      <footer className="appointment-actions-section appointment-history-actions">
        {isActive ? <form action={cancelAction}><ConfirmSubmitButton className="secondary-button" message={dictionary.appointments.cancelConfirmation}>{dictionary.appointments.cancelAppointment}</ConfirmSubmitButton></form> : null}
        <form className="appointment-delete-action" action={deleteAction}>
          <ConfirmSubmitButton className="danger-button" message={dictionary.appointments.deleteConfirmation}>
            {dictionary.appointments.deleteAppointment}
          </ConfirmSubmitButton>
        </form>
      </footer>
    </section>
  );
}
