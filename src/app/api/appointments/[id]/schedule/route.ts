import { NextRequest, NextResponse } from "next/server";
import { findAppointmentConflicts } from "@/lib/appointment-conflicts";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const artistId = session.user.id;
  const appointment = await prisma.appointment.findFirst({
    where: { id, artistId },
    select: { id: true },
  });
  if (!appointment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "start_invalid" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const startsAt = new Date(typeof input.startsAt === "string" ? input.startsAt : "");
  const durationMinutes = Number(input.durationMinutes);
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: "start_invalid" }, { status: 400 });
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
    return NextResponse.json({ error: "duration_invalid" }, { status: 400 });
  }

  const conflicts = await findAppointmentConflicts({
    artistId,
    startsAt,
    durationMinutes,
    excludeAppointmentId: id,
  });
  if (conflicts.length > 0 && input.allowOverlap !== true) {
    return NextResponse.json({ error: "overlap", conflicts }, { status: 409 });
  }

  await prisma.appointment.update({
    where: { id },
    data: { startsAt, durationMinutes },
  });

  return NextResponse.json({ appointmentId: id });
}
