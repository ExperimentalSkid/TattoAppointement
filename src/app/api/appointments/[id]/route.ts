import { NextRequest, NextResponse } from "next/server";
import { parseAppointmentInput } from "@/lib/appointments";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

async function ownedAppointment(id: string, artistId: string) {
  return prisma.appointment.findFirst({
    where: { id, artistId },
    select: { id: true },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const appointment = await prisma.appointment.findFirst({
    where: { id, artistId: session.user.id },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      notes: true,
      status: true,
      client: { select: { id: true, name: true, phone: true } },
      designs: {
        orderBy: { design: { createdAt: "desc" } },
        select: {
          isFinal: true,
          design: { select: { id: true, title: true } },
        },
      },
    },
  });

  if (!appointment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ appointment });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const artistId = session.user.id;
  const { id } = await context.params;
  if (!(await ownedAppointment(id, artistId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = parseAppointmentInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, artistId },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 400 });

  if (parsed.data.designIds.length > 0) {
    const designCount = await prisma.design.count({
      where: { artistId, id: { in: parsed.data.designIds } },
    });
    if (designCount !== parsed.data.designIds.length) {
      return NextResponse.json({ error: "design_not_found" }, { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id },
      data: {
        clientId: parsed.data.clientId,
        startsAt: parsed.data.startsAt,
        durationMinutes: parsed.data.durationMinutes,
        notes: parsed.data.notes,
        status: parsed.data.status,
      },
    });

    await tx.appointmentDesign.deleteMany({ where: { appointmentId: id } });
    if (parsed.data.designIds.length > 0) {
      await tx.appointmentDesign.createMany({
        data: parsed.data.designIds.map((designId) => ({
          appointmentId: id,
          designId,
          isFinal: designId === parsed.data.finalDesignId,
        })),
      });
    }
  });

  return NextResponse.json({ appointmentId: id });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!(await ownedAppointment(id, session.user.id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.appointment.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
