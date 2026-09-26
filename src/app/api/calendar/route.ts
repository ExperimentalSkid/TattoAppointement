import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const start = new Date(request.nextUrl.searchParams.get("start") ?? "");
  const end = new Date(request.nextUrl.searchParams.get("end") ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: "range_invalid" }, { status: 400 });
  }
  if (end.getTime() - start.getTime() > 45 * 24 * 60 * 60_000) {
    return NextResponse.json({ error: "range_too_large" }, { status: 400 });
  }

  const candidates = await prisma.appointment.findMany({
    where: {
      artistId: session.user.id,
      startsAt: {
        gte: new Date(start.getTime() - 24 * 60 * 60_000),
        lt: end,
      },
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      status: true,
      client: { select: { name: true, phone: true } },
      designs: {
        where: { isFinal: true },
        take: 1,
        select: { design: { select: { id: true, title: true } } },
      },
    },
  });

  const appointments = candidates
    .filter((appointment) => {
      const appointmentEnd = new Date(
        appointment.startsAt.getTime() + appointment.durationMinutes * 60_000,
      );
      return appointment.startsAt < end && appointmentEnd > start;
    })
    .map((appointment) => ({
      id: appointment.id,
      startsAt: appointment.startsAt,
      durationMinutes: appointment.durationMinutes,
      status: appointment.status,
      clientName: appointment.client.name,
      clientPhone: appointment.client.phone,
      finalDesign: appointment.designs[0]?.design ?? null,
    }));

  return NextResponse.json({ appointments });
}
