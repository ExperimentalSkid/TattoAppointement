import { NextRequest, NextResponse } from "next/server";
import { getAppointmentMoneySnapshot } from "@/lib/appointment-money";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; paymentId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, paymentId } = await context.params;
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      appointmentId: id,
      artistId: session.user.id,
      appointment: { artistId: session.user.id },
    },
    select: { id: true },
  });
  if (!payment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await prisma.payment.delete({ where: { id: paymentId } });
  const money = await getAppointmentMoneySnapshot(id, session.user.id);
  return NextResponse.json({ money });
}
