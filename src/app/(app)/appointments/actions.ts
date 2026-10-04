"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { nextRecordVersion, readRecordVersion, StaleRecordError } from "@/lib/record-version";
import {
  appointmentEnd,
  appointmentsOverlap,
  isAppointmentStatus,
  parseLocalDateTime,
  type AppointmentStatusValue,
} from "@/lib/appointments";
import { centsToDecimal, parseMoneyInput } from "@/lib/money";
import { classifyDiagnosticError, writeDiagnostic } from "@/lib/diagnostics";
import {
  APPOINTMENT_NOTES_MAX_LENGTH,
  type AppointmentConflict,
  type AppointmentFieldError,
  type AppointmentFormField,
  type AppointmentFormState,
} from "@/lib/appointment-form-model";

export type { AppointmentFormState } from "@/lib/appointment-form-model";

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

type FieldErrors = Partial<Record<AppointmentFormField, AppointmentFieldError>>;

function validationState(fieldErrors: FieldErrors): AppointmentFormState {
  return { error: Object.values(fieldErrors)[0] ?? "save", fieldErrors };
}

function parseSchedule(formData: FormData, fieldErrors: FieldErrors) {
  const startsAtLocalInput = String(formData.get("startsAtLocal") ?? "").trim();
  const [suppliedDate = "", suppliedTime = ""] = startsAtLocalInput.split("T");
  const date = formData.has("date") ? String(formData.get("date") ?? "").trim() : suppliedDate;
  const time = formData.has("time") ? String(formData.get("time") ?? "").trim() : suppliedTime;
  if (!date) fieldErrors.date = "required";
  if (!time) fieldErrors.time = "required";
  if (!date || !time) return null;

  const startsAtLocal = startsAtLocalInput || `${date}T${time}`;
  const offsetInput = String(formData.get("timezoneOffset") ?? "").trim();
  const timezoneOffset = Number(offsetInput);
  const timezoneName = String(formData.get("timezoneName") ?? "").trim();
  const startsAt = offsetInput && timezoneName
    ? parseLocalDateTime(startsAtLocal, timezoneOffset, timezoneName)
    : null;
  if (!startsAt || startsAtLocal !== `${date}T${time}`) {
    fieldErrors.date = "schedule";
    fieldErrors.time = "schedule";
    return null;
  }
  return startsAt;
}

function parseInput(formData: FormData, durationMinutes = 120): AppointmentInput | AppointmentFormState {
  const fieldErrors: FieldErrors = {};
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!clientId) fieldErrors.clientId = "required";
  const startsAt = parseSchedule(formData, fieldErrors);
  const notes = cleanOptional(formData.get("notes"));
  const statusRaw = String(formData.get("status") ?? "PLANNED").trim();
  const designIds = uniqueStrings(formData.getAll("designIds"));
  const finalDesignRaw = String(formData.get("finalDesignId") ?? "").trim();
  const finalDesignId = finalDesignRaw || null;
  const allowOverlap = formData.get("allowOverlap") === "true";
  const agreedPriceCents = parseMoneyInput(String(formData.get("agreedPrice") ?? ""), { optional: true });
  const depositRequiredParsed = parseMoneyInput(String(formData.get("depositRequired") ?? "").trim() || "0");
  const initialPaymentParsed = parseMoneyInput(String(formData.get("initialPayment") ?? "").trim() || "0");

  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) return { error: "save" };
  if (!isAppointmentStatus(statusRaw)) fieldErrors.status = "status";
  if (notes && notes.length > APPOINTMENT_NOTES_MAX_LENGTH) fieldErrors.notes = "notes";
  if (finalDesignId && !designIds.includes(finalDesignId)) fieldErrors.finalDesignId = "final";
  if (agreedPriceCents === undefined) fieldErrors.agreedPrice = "money";
  if (depositRequiredParsed === undefined || depositRequiredParsed === null) fieldErrors.depositRequired = "money";
  if (initialPaymentParsed === undefined || initialPaymentParsed === null) fieldErrors.initialPayment = "money";
  if (agreedPriceCents !== null && agreedPriceCents !== undefined && depositRequiredParsed != null && depositRequiredParsed > agreedPriceCents) {
    fieldErrors.depositRequired = "deposit";
  }
  if (Object.keys(fieldErrors).length) return validationState(fieldErrors);
  // Validation above accumulates every field error before returning. These
  // checks also narrow the successfully parsed values for TypeScript.
  if (!startsAt || !isAppointmentStatus(statusRaw) || agreedPriceCents === undefined || depositRequiredParsed == null || initialPaymentParsed == null) return { error: "save" };

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
  const fieldErrors: FieldErrors = {};
  if (!client) fieldErrors.clientId = "client";
  if (designs.length !== input.designIds.length) fieldErrors.designIds = "designs";
  if (Object.keys(fieldErrors).length) return validationState(fieldErrors);
  return null;
}

class ScheduleConflictError extends Error {
  constructor(readonly conflicts: AppointmentConflict[]) {
    super("Appointment overlaps an existing booking.");
  }
}

async function scheduleConflicts(database: Pick<typeof prisma, "appointment">, artistId: string, input: Pick<AppointmentInput, "startsAt" | "durationMinutes" | "status">, excludeAppointmentId?: string): Promise<AppointmentConflict[]> {
  if (input.status === "CANCELLED") return [];
  const candidateEnd = appointmentEnd(input.startsAt, input.durationMinutes);
  const earliestPossibleStart = new Date(input.startsAt.getTime() - 24 * 60 * 60 * 1000);
  const nearby = await database.appointment.findMany({
    where: {
      artistId,
      status: { not: "CANCELLED" },
      id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
      startsAt: { gte: earliestPossibleStart, lt: candidateEnd },
    },
    select: { id: true, client: { select: { name: true } }, startsAt: true, durationMinutes: true },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  return nearby
    .filter((appointment) => appointmentsOverlap(input.startsAt, input.durationMinutes, appointment.startsAt, appointment.durationMinutes))
    .map((appointment) => ({ id: appointment.id, clientName: appointment.client.name, startsAtIso: appointment.startsAt.toISOString() }));
}

async function revalidateAppointmentRelations(appointmentId: string, clientId: string, designIds: string[]) {
  revalidatePath(`/appointments/${appointmentId}`);
  revalidatePath(`/appointments/${appointmentId}/edit`);
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

  let appointmentId: string;
  try {
    const appointment = await prisma.$transaction(async (tx) => {
      // Serialize schedule writes for this artist so concurrent saves both check
      // the latest committed calendar before allowing an overlap.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
      if (!parsed.allowOverlap) {
        const conflicts = await scheduleConflicts(tx, artistId, parsed);
        if (conflicts.length) throw new ScheduleConflictError(conflicts);
      }
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
      if (parsed.designIds.length) {
        await tx.appointmentDesign.createMany({
          data: parsed.designIds.map((designId) => ({ appointmentId: created.id, designId, isFinal: designId === parsed.finalDesignId })),
        });
      }
      if (parsed.initialPaymentCents > 0) {
        await tx.payment.create({
          data: { artistId, appointmentId: created.id, amount: centsToDecimal(parsed.initialPaymentCents) },
        });
      }
      return created;
    });
    appointmentId = appointment.id;
  } catch (error) {
    if (error instanceof ScheduleConflictError) return { error: "overlap", conflicts: error.conflicts };
    await writeDiagnostic({ code: "appointment_create_failed", artistId, outcome: "failed", reason: "save", errorKind: classifyDiagnosticError(error) });
    return { error: "save" };
  }
  await writeDiagnostic({ code: "appointment_create_saved", artistId, outcome: "saved" });
  await revalidateAppointmentRelations(appointmentId, parsed.clientId, parsed.designIds);
  redirect(`/appointments/${appointmentId}`);
}

export async function updateAppointment(appointmentId: string, _previousState: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> {
  const artistId = await requireArtistId();
  const expectedVersion = readRecordVersion(formData.get("expectedVersion"));
  if (!expectedVersion) return { error: "stale" };
  const existing = await prisma.appointment.findFirst({ where: { id: appointmentId, artistId }, include: { designs: { select: { designId: true } } } });
  if (!existing || existing.updatedAt.getTime() !== expectedVersion.getTime()) return { error: "stale" };
  const parsed = parseInput(formData, existing.durationMinutes);
  if ("error" in parsed) return parsed;
  const ownershipError = await validateOwnership(artistId, parsed);
  if (ownershipError) return ownershipError;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
      const current = await tx.appointment.findFirst({ where: { id: appointmentId, artistId, updatedAt: expectedVersion }, select: { id: true } });
      if (!current) throw new StaleRecordError();
      if (!parsed.allowOverlap) {
        const conflicts = await scheduleConflicts(tx, artistId, parsed, appointmentId);
        if (conflicts.length) throw new ScheduleConflictError(conflicts);
      }
      const updated = await tx.appointment.updateMany({
        where: { id: appointmentId, artistId, updatedAt: expectedVersion },
        data: {
          updatedAt: nextRecordVersion(expectedVersion),
          clientId: parsed.clientId,
          startsAt: parsed.startsAt,
          durationMinutes: parsed.durationMinutes,
          notes: parsed.notes,
          status: parsed.status,
          agreedPrice: parsed.agreedPriceCents === null ? null : centsToDecimal(parsed.agreedPriceCents),
          depositRequired: centsToDecimal(parsed.depositRequiredCents),
        },
      });
      if (updated.count !== 1) throw new StaleRecordError();
      await tx.appointmentDesign.deleteMany({ where: { appointmentId } });
      if (parsed.designIds.length) {
        await tx.appointmentDesign.createMany({
          data: parsed.designIds.map((designId) => ({ appointmentId, designId, isFinal: designId === parsed.finalDesignId })),
        });
      }
    });
  } catch (error) {
    if (error instanceof StaleRecordError) return { error: "stale" };
    if (error instanceof ScheduleConflictError) return { error: "overlap", conflicts: error.conflicts };
    await writeDiagnostic({ code: "appointment_update_failed", artistId, outcome: "failed", reason: "save", errorKind: classifyDiagnosticError(error) });
    return { error: "save" };
  }

  await writeDiagnostic({ code: "appointment_update_saved", artistId, outcome: "saved" });
  const previousDesignIds = existing.designs.map((item) => item.designId);
  await revalidateAppointmentRelations(appointmentId, parsed.clientId, Array.from(new Set([...previousDesignIds, ...parsed.designIds])));
  if (existing.clientId !== parsed.clientId) revalidatePath(`/clients/${existing.clientId}`);
  redirect(`/appointments/${appointmentId}`);
}

class InactiveAppointmentError extends Error {}

export async function rescheduleAppointment(appointmentId: string, _previousState: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> {
  const artistId = await requireArtistId();
  const expectedVersion = readRecordVersion(formData.get("expectedVersion"));
  if (!expectedVersion) return { error: "stale" };
  const fieldErrors: FieldErrors = {};
  const startsAt = parseSchedule(formData, fieldErrors);
  if (Object.keys(fieldErrors).length) return validationState(fieldErrors);
  if (!startsAt) return { error: "save" };
  const allowOverlap = formData.get("allowOverlap") === "true";

  let relations: { clientId: string; designIds: string[] };
  try {
    relations = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
      const appointment = await tx.appointment.findFirst({
        where: { id: appointmentId, artistId },
        select: { clientId: true, status: true, durationMinutes: true, updatedAt: true, designs: { select: { designId: true } } },
      });
      if (!appointment || appointment.updatedAt.getTime() !== expectedVersion.getTime()) throw new StaleRecordError();
      if (appointment.status !== "PLANNED" && appointment.status !== "CONFIRMED") throw new InactiveAppointmentError();
      if (!allowOverlap) {
        const conflicts = await scheduleConflicts(tx, artistId, {
          startsAt,
          status: appointment.status,
          durationMinutes: appointment.durationMinutes,
        }, appointmentId);
        if (conflicts.length) throw new ScheduleConflictError(conflicts);
      }
      const updated = await tx.appointment.updateMany({ where: { id: appointmentId, artistId, updatedAt: expectedVersion }, data: { startsAt, updatedAt: nextRecordVersion(expectedVersion) } });
      if (updated.count !== 1) throw new StaleRecordError();
      return { clientId: appointment.clientId, designIds: appointment.designs.map((design) => design.designId) };
    });
  } catch (error) {
    if (error instanceof StaleRecordError) return { error: "stale" };
    if (error instanceof ScheduleConflictError) return { error: "overlap", conflicts: error.conflicts };
    if (error instanceof InactiveAppointmentError) return { error: "status", fieldErrors: { status: "status" } };
    await writeDiagnostic({ code: "appointment_reschedule_failed", artistId, outcome: "failed", reason: "save", errorKind: classifyDiagnosticError(error) });
    return { error: "save" };
  }
  await writeDiagnostic({ code: "appointment_reschedule_saved", artistId, outcome: "saved" });
  await revalidateAppointmentRelations(appointmentId, relations.clientId, relations.designIds);
  redirect(`/appointments/${appointmentId}`);
}

export async function cancelAppointment(appointmentId: string) {
  const artistId = await requireArtistId();
  const appointment = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
    const existing = await tx.appointment.findFirst({ where: { id: appointmentId, artistId }, include: { designs: { select: { designId: true } } } });
    if (!existing) return null;
    const result = await tx.appointment.updateMany({
      where: { id: existing.id, artistId, status: { in: ["PLANNED", "CONFIRMED"] } },
      data: { status: "CANCELLED", updatedAt: nextRecordVersion(existing.updatedAt) },
    });
    return { ...existing, cancelled: result.count > 0 };
  });
  if (!appointment) redirect("/new-appointment");
  if (appointment.cancelled) await writeDiagnostic({ code: "appointment_cancelled", artistId, outcome: "saved" });
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
