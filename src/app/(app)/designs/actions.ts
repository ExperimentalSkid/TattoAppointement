"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { nextRecordVersion, readRecordVersion } from "@/lib/record-version";
import { removeDesignFiles } from "@/lib/design-storage";
import { designDetailPath, designLibraryPath, normalizeDesignQuery } from "@/lib/design-navigation";

export type DesignFormState = {
  error: "title" | "notes" | "stale" | "save" | null;
};

export async function updateDesign(
  designId: string,
  _previousState: DesignFormState,
  formData: FormData,
): Promise<DesignFormState> {
  const artistId = await requireArtistId();
  const expectedVersion = readRecordVersion(formData.get("expectedVersion"));
  if (!expectedVersion) return { error: "stale" };
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
    select: { id: true, updatedAt: true },
  });

  if (!existing || existing.updatedAt.getTime() !== expectedVersion.getTime()) {
    return { error: "stale" };
  }

  try {
    const updated = await prisma.design.updateMany({
      where: { id: designId, artistId, updatedAt: expectedVersion },
      data: {
        updatedAt: nextRecordVersion(expectedVersion),
        title,
        notes: notesText || null,
      },
    });
    if (updated.count !== 1) return { error: "stale" };
  } catch {
    return { error: "save" };
  }

  revalidatePath("/designs");
  revalidatePath(`/designs/${designId}`);
  redirect(designDetailPath(designId, normalizeDesignQuery(formData.get("libraryQuery"))));
}

export async function deleteDesign(designId: string, formData: FormData) {
  const artistId = await requireArtistId();
  const libraryPath = designLibraryPath(normalizeDesignQuery(formData.get("libraryQuery")));
  const design = await prisma.design.findFirst({
    where: { id: designId, artistId },
    select: { storageKey: true, previewKey: true },
  });

  if (!design) redirect(libraryPath);

  await prisma.design.deleteMany({ where: { id: designId, artistId } });
  await removeDesignFiles([design.storageKey, design.previewKey]);

  revalidatePath("/designs");
  revalidatePath(`/designs/${designId}`);
  revalidatePath(`/designs/${designId}/edit`);
  revalidatePath("/new-appointment");
  revalidatePath("/appointments/[id]", "page");
  revalidatePath("/appointments/[id]/edit", "page");
  revalidatePath("/clients/[id]", "page");
  redirect(libraryPath);
}
