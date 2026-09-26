import { NextRequest, NextResponse } from "next/server";
import { parseClientInput } from "@/lib/clients";
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
  const client = await prisma.client.findFirst({
    where: {
      id,
      artistId: auth.artistId,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      appointments: {
        orderBy: { startsAt: "desc" },
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          status: true,
        },
      },
    },
  });

  if (!client) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ client });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await artistIdOrResponse();
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  const parsed = parseClientInput(await request.json().catch(() => null));

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const ownedClient = await prisma.client.findFirst({
    where: {
      id,
      artistId: auth.artistId,
    },
    select: { id: true },
  });

  if (!ownedClient) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const duplicate = await prisma.client.findFirst({
    where: {
      artistId: auth.artistId,
      phone: parsed.data.phone,
      id: { not: id },
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

  if (duplicate) {
    const { _count, ...client } = duplicate;
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

  const client = await prisma.client.update({
    where: { id },
    data: parsed.data,
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

  const { _count, ...data } = client;
  return NextResponse.json({
    client: {
      ...data,
      appointmentCount: _count.appointments,
    },
  });
}
