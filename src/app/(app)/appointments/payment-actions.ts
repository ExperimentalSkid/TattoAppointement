"use server";

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

  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, artistId },
    select: { id: true },
  });
  if (!appointment) return { error: "save", success: false };

  try {
    await prisma.payment.create({
      data: {
        artistId,
        appointmentId: appointment.id,
        amount: centsToDecimal(amountCents),
      },
    });
  } catch {
    return { error: "save", success: false };
  }

  revalidatePath(`/appointments/${appointment.id}`);
  return { error: null, success: true };
}
