"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { centsToDecimal, parseMoneyInput } from "@/lib/money";

export type PaymentFormState = {
  error: "amount" | "save" | null;
  success: boolean;
};

export async function recordPayment(
  appointmentId: string,
  _previousState: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const artistId = await requireArtistId();
  const amountCents = parseMoneyInput(String(formData.get("amount") ?? ""));
  if (amountCents === undefined || amountCents === null || amountCents <= 0) {
    return { error: "amount", success: false };
  }
  const submissionId = formData.get("submissionId");
  if (submissionId !== null && (typeof submissionId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId))) {
    return { error: "save", success: false };
  }

  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, artistId },
    select: { id: true },
  });
  if (!appointment) return { error: "save", success: false };

  const amount = centsToDecimal(amountCents);
  try {
    const data = { artistId, appointmentId: appointment.id, amount };
    if (submissionId === null) {
      // Previously rendered forms did not provide a submission identity.
      await prisma.payment.create({ data });
    } else {
      const id = `payment_${createHash("sha256")
        .update(JSON.stringify([artistId, appointment.id, submissionId.toLowerCase()]))
        .digest("hex")}`;
      // The existing primary key makes concurrent retries atomic. Amount is
      // intentionally excluded so changing an already saved intent fails safely.
      const created = await prisma.payment.createMany({ data: [{ id, ...data }], skipDuplicates: true });
      if (created.count === 0) {
        const existing = await prisma.payment.findFirst({
          where: { id, artistId, appointmentId: appointment.id, amount },
          select: { id: true },
        });
        if (!existing) return { error: "save", success: false };
      }
    }
  } catch {
    return { error: "save", success: false };
  }

  revalidatePath(`/appointments/${appointment.id}`);
  return { error: null, success: true };
}

export async function deletePayment(paymentId: string, appointmentId: string) {
  const artistId = await requireArtistId();
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      appointmentId,
      artistId,
    },
    select: { id: true, appointmentId: true },
  });

  if (!payment) return;

  await prisma.payment.delete({ where: { id: payment.id } });
  revalidatePath(`/appointments/${payment.appointmentId}`);
}
