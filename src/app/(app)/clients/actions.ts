"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { nextRecordVersion, readRecordVersion } from "@/lib/record-version";
import { appointmentReturnWithSelection, validateAppointmentReturn } from "@/lib/appointment-return";
import { normalizeClientPhone, readClientFields, type ClientField } from "@/lib/client-fields";

export type ClientFormState = {
  error: ClientField | "required" | "duplicate" | "stale" | "save" | null;
  fields?: ClientField[];
};

async function duplicatePhoneExists(artistId: string, phone: string, excludeId?: string) {
  const candidates = await prisma.client.findMany({
    where: {
      artistId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { phone: true },
  });

  return candidates.some((client) => normalizeClientPhone(client.phone) === phone);
}

export async function createClient(
  _previousState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  return saveNewClient(formData, null);
}

export async function createClientForAppointment(
  returnTo: string,
  _previousState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  return saveNewClient(formData, validateAppointmentReturn(returnTo));
}

async function saveNewClient(formData: FormData, returnTo: string | null): Promise<ClientFormState> {
  const artistId = await requireArtistId();
  const { values, fields } = readClientFields(formData);
  if (fields.length) {
    return { error: fields[0], fields };
  }

  let clientId: string;
  try {
    if (await duplicatePhoneExists(artistId, values.phone)) {
      return { error: "duplicate", fields: ["phone"] };
    }
    const client = await prisma.client.create({
      data: {
        artistId,
        ...values,
      },
      select: { id: true },
    });

    clientId = client.id;
  } catch {
    return { error: "save" };
  }

  revalidatePath("/clients");
  const appointmentReturn = appointmentReturnWithSelection(returnTo, "createdClient", clientId);
  if (appointmentReturn) {
    revalidatePath(appointmentReturn.split("?")[0]);
    redirect(appointmentReturn);
  }
  redirect(`/clients/${clientId}`);
}

export async function updateClient(
  clientId: string,
  _previousState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const artistId = await requireArtistId();
  const expectedVersion = readRecordVersion(formData.get("expectedVersion"));
  if (!expectedVersion) return { error: "stale" };
  const { values, fields } = readClientFields(formData);
  if (fields.length) {
    return { error: fields[0], fields };
  }

  try {
    const existing = await prisma.client.findFirst({
      where: { id: clientId, artistId },
      select: { id: true, updatedAt: true },
    });
    if (!existing || existing.updatedAt.getTime() !== expectedVersion.getTime()) {
      return { error: "stale" };
    }
    if (await duplicatePhoneExists(artistId, values.phone, clientId)) {
      return { error: "duplicate", fields: ["phone"] };
    }
    const updated = await prisma.client.updateMany({
      where: { id: clientId, artistId, updatedAt: expectedVersion },
      data: { ...values, updatedAt: nextRecordVersion(expectedVersion) },
    });
    if (updated.count !== 1) return { error: "stale" };

    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId}`);
    redirect(`/clients/${clientId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      throw error;
    }
    return { error: "save" };
  }
}
