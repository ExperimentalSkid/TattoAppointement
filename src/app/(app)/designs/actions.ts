"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";

export type DesignFormState = {
  error: "title" | "notes" | "save" | null;
};

export async function updateDesign(
  designId: string,
  _previousState: DesignFormState,
  formData: FormData,
): Promise<DesignFormState> {
  const artistId = await requireArtistId();
  const title = String(formData.get("title") ?? "").trim();
  const notesText = String(formData.get("notes") ?? "").trim();

  if (!title || title.length > 160) {
    return { error: "title" };
  }

  if (notesText.length > 4000) {
    return { error: "notes" };
  }

  const existing = await prisma.design.findFirst({
    where: { id: designId, artistId },
    select: { id: true },
  });

  if (!existing) {
    return { error: "save" };
  }

  try {
    await prisma.design.update({
      where: { id: designId },
      data: {
        title,
        notes: notesText || null,
      },
    });
  } catch {
    return { error: "save" };
  }

  revalidatePath("/designs");
  revalidatePath(`/designs/${designId}`);
  redirect(`/designs/${designId}`);
}
