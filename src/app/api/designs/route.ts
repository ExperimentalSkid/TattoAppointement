import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  DesignImageError,
  MAX_DESIGN_FILE_SIZE,
  removeDesignFiles,
  saveDesignImage,
} from "@/lib/design-storage";
import { readUploadFormData, UploadBodyError } from "@/lib/uploads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expectedOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  const origin = request.headers.get("origin");
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await readUploadFormData(request, MAX_DESIGN_FILE_SIZE + 64 * 1024);
  } catch (error) {
    const code = error instanceof UploadBodyError ? error.code : "invalid_body";
    return NextResponse.json({ error: code }, { status: code === "too_large" ? 413 : 400 });
  }
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
