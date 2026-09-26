import { NextRequest, NextResponse } from "next/server";
import { getAppointmentMoneySnapshot } from "@/lib/appointment-money";
import { centsToDecimalString, parseMoneyToCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const owned = await prisma.appointment.findFirst({
    where: { id, artistId: session.user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "payment_invalid" }, { status: 400 });
  }

  try {
    const input = body as Record<string, unknown>;
    const amountCents = parseMoneyToCents(input.amount, false) ?? 0;
    if (amountCents <= 0) {
      return NextResponse.json({ error: "payment_invalid" }, { status: 400 });
    }

    const dateReceived = new Date(
      typeof input.dateReceived === "string" && input.dateReceived
        ? `${input.dateReceived}T12:00:00`
        : Date.now(),
    );
    if (Number.isNaN(dateReceived.getTime())) {
      return NextResponse.json({ error: "payment_invalid" }, { status: 400 });
    }

    await prisma.payment.create({
      data: {
        artistId: session.user.id,
        appointmentId: id,
        amount: centsToDecimalString(amountCents),
        dateReceived,
      },
    });

    const money = await getAppointmentMoneySnapshot(id, session.user.id);
    return NextResponse.json({ money }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "payment_invalid" }, { status: 400 });
  }
}
