"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import {
  appointmentEnd,
  appointmentsOverlap,
  isAppointmentStatus,
  parseLocalDateTime,
  type AppointmentStatusValue,
} from "@/lib/appointments";
import { centsToDecimal, parseMoneyInput } from "@/lib/money";

export type AppointmentFormState = {
  error:
    | "required"
    | "schedule"
    | "duration"
    | "client"
    | "designs"
    | "final"
    | "money"
    | "deposit"
    | "overlap"
    | "save"
    | null;
};

type AppointmentInput = {
  clientId: string;
  startsAt: Date;
  durationMinutes: number;
  notes: string | null;
  status: AppointmentStatusValue;
  designIds: string[];
  finalDesignId: string | null;
  agreedPriceCents: number | null;
  depositRequiredCents: number;
  initialPaymentCents: number;
  allowOverlap: boolean;
};

function cleanOptional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function uniqueStrings(values: FormDataEntryValue[]) {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function parseInput(formData: FormData): AppointmentInput | AppointmentFormState {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const startsAtLocal = String(formData.get("startsAtLocal") ?? "").trim();
  const timezoneOffset = Number(formData.get("timezoneOffset"));
  const timezoneName = String(formData.get("timezoneName") ?? "").trim() || null;
  const durationMinutes = Number(formData.get("durationMinutes"));
  const notes = cleanOptional(formData.get("notes"));
  const statusRaw = String(formData.get("status") ?? "PLANNED");
  const designIds = uniqueStrings(formData.getAll("designIds"));
  const finalDesignRaw = String(formData.get("finalDesignId") ?? "").trim();
  const finalDesignId = finalDesignRaw || null;
  const allowOverlap = formData.get("allowOverlap") === "true";
  const agreedPriceCents = parseMoneyInput(String(formData.get("agreedPrice") ?? ""), { optional: true });
  const depositRequiredParsed = parseMoneyInput(String(formData.get("depositRequired") ?? "0"));
  const initialPaymentParsed = parseMoneyInput(String(formData.get("initialPayment") ?? "0"));

  if (!clientId || !startsAtLocal) return { error: "required" };
  const startsAt = parseLocalDateTime(startsAtLocal, timezoneOffset, timezoneName);
  if (!startsAt) return { error: "schedule" };
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) return { error: "duration" };
  if (!isAppointmentStatus(statusRaw)) return { error: "save" };
  if (!designIds.length) return { error: "designs" };
  if (finalDesignId && !designIds.includes(finalDesignId)) return { error: "final" };
  if (agreedPriceCents === undefined || depositRequiredParsed === undefined || depositRequiredParsed === null || initialPaymentParsed === undefined || initialPaymentParsed === null) return { error: "money" };
  if (agreedPriceCents !== null && depositRequiredParsed > agreedPriceCents) return { error: "deposit" };

  return {
    clientId,
    startsAt,
    durationMinutes,
    notes,
    status: statusRaw,
    designIds,
    finalDesignId,
    agreedPriceCents,
    depositRequiredCents: depositRequiredParsed,
    initialPaymentCents: initialPaymentParsed,
    allowOverlap,
  };
}

async function validateOwnership(artistId: string, input: AppointmentInput): Promise<AppointmentFormState | null> {
  const [client, designs] = await Promise.all([
    prisma.client.findFirst({ where: { id: input.clientId, artistId }, select: { id: true } }),
    prisma.design.findMany({ where: { artistId, id: { in: input.designIds } }, select: { id: true } }),
  ]);
  if (!client) return { error: "client" };
  if (designs.length !== input.designIds.length) return { error: "designs" };
  return null;
}

async function hasScheduleConflict(artistId: string, input: AppointmentInput, excludeAppointmentId?: string) {
  if (input.status === "CANCELLED") return false;
  const candidateEnd = appointmentEnd(input.startsAt, input.durationMinutes);
  const earliestPossibleStart = new Date(input.startsAt.getTime() - 24 * 60 * 60 * 1000);
  const nearby = await prisma.appointment.findMany({
    where: {
      artistId,
      status: { not: "CANCELLED" },
      id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
      startsAt: { gte: earliestPossibleStart, lt: candidateEnd },
    },
    select: { startsAt: true, durationMinutes: true },
  });
  return nearby.some((appointment) => appointmentsOverlap(input.startsAt, input.durationMinutes, appointment.startsAt, appointment.durationMinutes));
}

async function revalidateAppointmentRelations(appointmentId: string, clientId: string, designIds: string[]) {
  revalidatePath(`/appointments/${appointmentId}`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/designs");
  revalidatePath("/calendar");
  for (const designId of designIds) revalidatePath(`/designs/${designId}`);
}

export async function createAppointment(_previousState: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> {
  const artistId = await requireArtistId();
  const parsed = parseInput(formData);
  if ("error" in parsed) return parsed;
  const ownershipError = await validateOwnership(artistId, parsed);
  if (ownershipError) return ownershipError;
  if (!parsed.allowOverlap && (await hasScheduleConflict(artistId, parsed))) return { error: "overlap" };

  let appointmentId: string;
  try {
    const appointment = await prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          artistId,
          clientId: parsed.clientId,
          startsAt: parsed.startsAt,
          durationMinutes: parsed.durationMinutes,
          notes: parsed.notes,
          status: parsed.status,
          agreedPrice: parsed.agreedPriceCents === null ? null : centsToDecimal(parsed.agreedPriceCents),
          depositRequired: centsToDecimal(parsed.depositRequiredCents),
        },
        select: { id: true },
      });
      await tx.appointmentDesign.createMany({
        data: parsed.designIds.map((designId) => ({ appointmentId: created.id, designId, isFinal: designId === parsed.finalDesignId })),
      });
      if (parsed.initialPaymentCents > 0) {
        await tx.payment.create({
          data: { artistId, appointmentId: created.id, amount: centsToDecimal(parsed.initialPaymentCents) },
        });
      }
      return created;
    });
    appointmentId = appointment.id;
  } catch {
    return { error: "save" };
  }
  await revalidateAppointmentRelations(appointmentId, parsed.clientId, parsed.designIds);
  redirect(`/appointments/${appointmentId}`);
}

export async function updateAppointment(appointmentId: string, _previousState: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> {
  const artistId = await requireArtistId();
  const existing = await prisma.appointment.findFirst({ where: { id: appointmentId, artistId }, include: { designs: { select: { designId: true } } } });
  if (!existing) return { error: "save" };
  const parsed = parseInput(formData);
  if ("error" in parsed) return parsed;
  const ownershipError = await validateOwnership(artistId, parsed);
  if (ownershipError) return ownershipError;
  if (!parsed.allowOverlap && (await hasScheduleConflict(artistId, parsed, appointmentId))) return { error: "overlap" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          clientId: parsed.clientId,
          startsAt: parsed.startsAt,
          durationMinutes: parsed.durationMinutes,
          notes: parsed.notes,
          status: parsed.status,
          agreedPrice: parsed.agreedPriceCents === null ? null : centsToDecimal(parsed.agreedPriceCents),
          depositRequired: centsToDecimal(parsed.depositRequiredCents),
        },
      });
      await tx.appointmentDesign.deleteMany({ where: { appointmentId } });
      await tx.appointmentDesign.createMany({
        data: parsed.designIds.map((designId) => ({ appointmentId, designId, isFinal: designId === parsed.finalDesignId })),
      });
    });
  } catch {
    return { error: "save" };
  }

  const previousDesignIds = existing.designs.map((item) => item.designId);
  await revalidateAppointmentRelations(appointmentId, parsed.clientId, Array.from(new Set([...previousDesignIds, ...parsed.designIds])));
  if (existing.clientId !== parsed.clientId) revalidatePath(`/clients/${existing.clientId}`);
  redirect(`/appointments/${appointmentId}`);
}

export async function cancelAppointment(appointmentId: string) {
  const artistId = await requireArtistId();
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, artistId }, include: { designs: { select: { designId: true } } } });
  if (!appointment) redirect("/new-appointment");
  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "CANCELLED" } });
  await revalidateAppointmentRelations(appointment.id, appointment.clientId, appointment.designs.map((item) => item.designId));
  redirect(`/appointments/${appointment.id}`);
}

export async function deleteAppointment(appointmentId: string) {
  const artistId = await requireArtistId();
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, artistId }, include: { designs: { select: { designId: true } } } });
  if (!appointment) redirect("/new-appointment");
  await prisma.appointment.delete({ where: { id: appointment.id } });
  revalidatePath(`/clients/${appointment.clientId}`);
  revalidatePath("/clients");
  revalidatePath("/designs");
  revalidatePath("/calendar");
  for (const design of appointment.designs) revalidatePath(`/designs/${design.designId}`);
  redirect(`/clients/${appointment.clientId}`);
}
