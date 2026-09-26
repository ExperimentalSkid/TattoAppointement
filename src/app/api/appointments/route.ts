import { NextRequest, NextResponse } from "next/server";
import { findAppointmentConflicts } from "@/lib/appointment-conflicts";
import { parseAppointmentInput } from "@/lib/appointments";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const artistId = session.user.id;
  const body = await request.json().catch(() => null);
  const parsed = parseAppointmentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, artistId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "client_not_found" }, { status: 400 });
  }

  if (parsed.data.designIds.length > 0) {
    const designCount = await prisma.design.count({
      where: {
        artistId,
        id: { in: parsed.data.designIds },
      },
    });
    if (designCount !== parsed.data.designIds.length) {
      return NextResponse.json({ error: "design_not_found" }, { status: 400 });
    }
  }

  const allowOverlap = Boolean(
    body && typeof body === "object" && (body as Record<string, unknown>).allowOverlap === true,
  );
  const conflicts = await findAppointmentConflicts({
    artistId,
    startsAt: parsed.data.startsAt,
    durationMinutes: parsed.data.durationMinutes,
  });

  if (conflicts.length > 0 && !allowOverlap) {
    return NextResponse.json({ error: "overlap", conflicts }, { status: 409 });
  }

  const appointment = await prisma.appointment.create({
    data: {
      artistId,
      clientId: parsed.data.clientId,
      startsAt: parsed.data.startsAt,
      durationMinutes: parsed.data.durationMinutes,
      notes: parsed.data.notes,
      status: parsed.data.status,
      designs: {
        create: parsed.data.designIds.map((designId) => ({
          designId,
          isFinal: designId === parsed.data.finalDesignId,
        })),
      },
    },
    select: { id: true },
  });

  return NextResponse.json({ appointmentId: appointment.id }, { status: 201 });
}
