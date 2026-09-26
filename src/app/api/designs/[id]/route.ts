import { NextRequest, NextResponse } from "next/server";
import { parseDesignMetadata } from "@/lib/designs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

async function artistIdOrResponse() {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { artistId: session.user.id } as const;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await artistIdOrResponse();
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  const design = await prisma.design.findFirst({
    where: { id, artistId: auth.artistId },
    select: {
      id: true,
      title: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { appointments: true } },
    },
  });

  if (!design) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    design: {
      id: design.id,
      title: design.title,
      notes: design.notes,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt,
      appointmentCount: design._count.appointments,
      thumbUrl: `/api/designs/${design.id}/image?variant=thumb`,
      previewUrl: `/api/designs/${design.id}/image?variant=preview`,
      originalUrl: `/api/designs/${design.id}/image?variant=original`,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await artistIdOrResponse();
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  const owned = await prisma.design.findFirst({
    where: { id, artistId: auth.artistId },
    select: { id: true },
  });

  if (!owned) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }

  const parsed = parseDesignMetadata(body as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const design = await prisma.design.update({
    where: { id },
    data: parsed.data,
    select: {
      id: true,
      title: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { appointments: true } },
    },
  });

  return NextResponse.json({
    design: {
      id: design.id,
      title: design.title,
      notes: design.notes,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt,
      appointmentCount: design._count.appointments,
      thumbUrl: `/api/designs/${design.id}/image?variant=thumb`,
      previewUrl: `/api/designs/${design.id}/image?variant=preview`,
      originalUrl: `/api/designs/${design.id}/image?variant=original`,
    },
  });
}
