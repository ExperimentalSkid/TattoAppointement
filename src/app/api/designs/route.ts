import { NextRequest, NextResponse } from "next/server";
import { MAX_DESIGN_IMAGE_BYTES, removeDesignImage, storeDesignImage } from "@/lib/design-storage";
import { parseDesignMetadata, titleFromFilename } from "@/lib/designs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

async function artistIdOrResponse() {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { artistId: session.user.id } as const;
}

function designResponse(design: {
  id: string;
  title: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { appointments: number };
}) {
  return {
    id: design.id,
    title: design.title,
    notes: design.notes,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    appointmentCount: design._count.appointments,
    thumbUrl: `/api/designs/${design.id}/image?variant=thumb`,
    previewUrl: `/api/designs/${design.id}/image?variant=preview`,
    originalUrl: `/api/designs/${design.id}/image?variant=original`,
  };
}

export async function GET(request: NextRequest) {
  const auth = await artistIdOrResponse();
  if ("response" in auth) return auth.response;

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const designs = await prisma.design.findMany({
    where: {
      artistId: auth.artistId,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { notes: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: {
      id: true,
      title: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { appointments: true } },
    },
  });

  return NextResponse.json({ designs: designs.map(designResponse) });
}

export async function POST(request: NextRequest) {
  const auth = await artistIdOrResponse();
  if ("response" in auth) return auth.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "upload_invalid" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }

  if (file.size > MAX_DESIGN_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }

  if (file.type && !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "image_invalid" }, { status: 400 });
  }

  const metadata = parseDesignMetadata(
    {
      title: formData.get("title"),
      notes: formData.get("notes"),
    },
    titleFromFilename(file.name),
  );

  if (!metadata.ok) {
    return NextResponse.json({ error: metadata.error }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let storageKey: string | null = null;

  try {
    const stored = await storeDesignImage(auth.artistId, bytes);
    storageKey = stored.key;

    const design = await prisma.design.create({
      data: {
        artistId: auth.artistId,
        imageUrl: stored.key,
        title: metadata.data.title,
        notes: metadata.data.notes,
      },
      select: {
        id: true,
        title: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { appointments: true } },
      },
    });

    return NextResponse.json({ design: designResponse(design) }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      await removeDesignImage(storageKey).catch(() => undefined);
    }

    const code = error instanceof Error ? error.message : "upload_failed";
    if (code === "image_size_invalid") {
      return NextResponse.json({ error: "image_too_large" }, { status: 413 });
    }
    if (code === "image_invalid") {
      return NextResponse.json({ error: "image_invalid" }, { status: 400 });
    }

    console.error(error);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
