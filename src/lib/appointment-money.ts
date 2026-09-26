import { calculateMoney, decimalLikeToCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export async function getAppointmentMoneySnapshot(appointmentId: string, artistId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, artistId },
    select: {
      id: true,
      agreedPrice: true,
      depositRequired: true,
      payments: {
        orderBy: [{ dateReceived: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          amount: true,
          dateReceived: true,
          createdAt: true,
        },
      },
    },
  });

  if (!appointment) return null;

  const agreedTotalCents = decimalLikeToCents(appointment.agreedPrice);
  const depositRequiredCents = decimalLikeToCents(appointment.depositRequired) ?? 0;
  const payments = appointment.payments.map((payment) => ({
    id: payment.id,
    amountCents: decimalLikeToCents(payment.amount) ?? 0,
    dateReceived: payment.dateReceived,
    createdAt: payment.createdAt,
  }));
  const receivedCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const calculated = calculateMoney({
    agreedTotalCents,
    depositRequiredCents,
    receivedCents,
  });

  return {
    appointmentId: appointment.id,
    agreedTotalCents,
    depositRequiredCents,
    receivedCents,
    ...calculated,
    payments,
  };
}
