import { NextRequest, NextResponse } from "next/server";
import { getAppointmentMoneySnapshot } from "@/lib/appointment-money";
import {
  centsToDecimalString,
  parseMoneyToCents,
  validateDepositAgainstTotal,
} from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const money = await getAppointmentMoneySnapshot(id, session.user.id);
  if (!money) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ money });
}

export async function PATCH(
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
    return NextResponse.json({ error: "money_invalid" }, { status: 400 });
  }

  try {
    const input = body as Record<string, unknown>;
    const agreedTotalCents = parseMoneyToCents(input.agreedTotal, true);
    const depositRequiredCents = parseMoneyToCents(input.depositRequired, false) ?? 0;
    validateDepositAgainstTotal(agreedTotalCents, depositRequiredCents);

    await prisma.appointment.update({
      where: { id },
      data: {
        agreedPrice: agreedTotalCents === null ? null : centsToDecimalString(agreedTotalCents),
        depositRequired: centsToDecimalString(depositRequiredCents),
      },
    });

    const money = await getAppointmentMoneySnapshot(id, session.user.id);
    return NextResponse.json({ money });
  } catch (error) {
    const code = error instanceof Error ? error.message : "money_invalid";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
