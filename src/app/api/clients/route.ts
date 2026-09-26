import { NextRequest, NextResponse } from "next/server";
import { parseClientInput } from "@/lib/clients";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";

export async function GET(request: NextRequest) {
  const artistId = await requireArtistId();
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  const clients = await prisma.client.findMany({
    where: {
      artistId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      updatedAt: true,
      _count: {
        select: { appointments: true },
      },
    },
  });

  return NextResponse.json({
    clients: clients.map(({ _count, ...client }) => ({
      ...client,
      appointmentCount: _count.appointments,
    })),
  });
}

export async function POST(request: NextRequest) {
  const artistId = await requireArtistId();
  const parsed = parseClientInput(await request.json().catch(() => null));

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await prisma.client.findFirst({
    where: {
      artistId,
      phone: parsed.data.phone,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      updatedAt: true,
      _count: {
        select: { appointments: true },
      },
    },
  });

  if (existing) {
    const { _count, ...client } = existing;
    return NextResponse.json(
      {
        error: "duplicate_phone",
        existing: {
          ...client,
          appointmentCount: _count.appointments,
        },
      },
      { status: 409 },
    );
  }

  const client = await prisma.client.create({
    data: {
      artistId,
      ...parsed.data,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(
    {
      client: {
        ...client,
        appointmentCount: 0,
      },
    },
    { status: 201 },
  );
}
