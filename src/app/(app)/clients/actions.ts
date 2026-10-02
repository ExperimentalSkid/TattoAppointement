"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { appointmentReturnWithSelection, validateAppointmentReturn } from "@/lib/appointment-return";
import { normalizeClientPhone, readClientFields, type ClientField } from "@/lib/client-fields";

export type ClientFormState = {
  error: ClientField | "required" | "duplicate" | "save" | null;
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
  const { values, fields } = readClientFields(formData);
  if (fields.length) {
    return { error: fields[0], fields };
  }

  try {
    const existing = await prisma.client.findFirst({
      where: { id: clientId, artistId },
      select: { id: true },
    });
    if (!existing) {
      return { error: "save" };
    }
    if (await duplicatePhoneExists(artistId, values.phone, clientId)) {
      return { error: "duplicate", fields: ["phone"] };
    }
    await prisma.client.update({
      where: { id: clientId },
      data: values,
    });

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
