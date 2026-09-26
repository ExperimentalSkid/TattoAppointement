"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";

export type ClientFormState = {
  error: "required" | "duplicate" | "save" | null;
};

export const initialClientFormState: ClientFormState = { error: null };

function cleanOptional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function normalizePhone(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().replace(/[\s().-]/g, "");
}

async function duplicatePhoneExists(artistId: string, phone: string, excludeId?: string) {
  const candidates = await prisma.client.findMany({
    where: {
      artistId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { phone: true },
  });

  return candidates.some((client) => normalizePhone(client.phone) === phone);
}

export async function createClient(
  _previousState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const artistId = await requireArtistId();
  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(formData.get("phone"));

  if (!name || !phone) {
    return { error: "required" };
  }

  if (await duplicatePhoneExists(artistId, phone)) {
    return { error: "duplicate" };
  }

  try {
    const client = await prisma.client.create({
      data: {
        artistId,
        name,
        phone,
        email: cleanOptional(formData.get("email")),
        notes: cleanOptional(formData.get("notes")),
      },
      select: { id: true },
    });

    revalidatePath("/clients");
    redirect(`/clients/${client.id}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      throw error;
    }
    return { error: "save" };
  }
}

export async function updateClient(
  clientId: string,
  _previousState: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const artistId = await requireArtistId();
  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(formData.get("phone"));

  if (!name || !phone) {
    return { error: "required" };
  }

  const existing = await prisma.client.findFirst({
    where: { id: clientId, artistId },
    select: { id: true },
  });

  if (!existing) {
    return { error: "save" };
  }

  if (await duplicatePhoneExists(artistId, phone, clientId)) {
    return { error: "duplicate" };
  }

  try {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        name,
        phone,
        email: cleanOptional(formData.get("email")),
        notes: cleanOptional(formData.get("notes")),
      },
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
