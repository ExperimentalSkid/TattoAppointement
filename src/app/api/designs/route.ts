import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  DesignImageError,
  removeDesignFiles,
  saveDesignImage,
} from "@/lib/design-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const notesText = String(formData.get("notes") ?? "").trim();
  const image = formData.get("image");

  if (!title || title.length > 160) {
    return NextResponse.json({ error: "title" }, { status: 400 });
  }

  if (notesText.length > 4000) {
    return NextResponse.json({ error: "notes" }, { status: 400 });
  }

  if (!(image instanceof File) || !image.size) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }

  let stored: Awaited<ReturnType<typeof saveDesignImage>> | null = null;

  try {
    stored = await saveDesignImage(image, session.user.id);

    const design = await prisma.design.create({
      data: {
        artistId: session.user.id,
        title,
        notes: notesText || null,
        storageKey: stored.storageKey,
        previewKey: stored.previewKey,
        mimeType: stored.mimeType,
        originalName: stored.originalName,
        fileSize: stored.fileSize,
      },
      select: { id: true },
    });

    return NextResponse.json({ id: design.id }, { status: 201 });
  } catch (error) {
    if (stored) {
      await removeDesignFiles([stored.storageKey, stored.previewKey]);
    }

    if (error instanceof DesignImageError) {
      return NextResponse.json({ error: error.code }, { status: 400 });
    }

    console.error("Could not store design image", error);
    return NextResponse.json({ error: "save" }, { status: 500 });
  }
}
