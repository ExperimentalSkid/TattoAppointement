import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { studioTimeZone } from "@/lib/studio-time";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const { id } = await params;
    const artistId = session.user.id;
    const record = await prisma.$transaction(async tx => tx.client.findFirst({
      where: { id, artistId },
      select: {
        id: true, name: true, phone: true, email: true, notes: true, createdAt: true, updatedAt: true,
        appointments: {
          where: { artistId }, orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          select: {
            id: true, startsAt: true, durationMinutes: true, status: true, notes: true,
            agreedPrice: true, depositRequired: true, createdAt: true, updatedAt: true,
            payments: { where: { artistId }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
              select: { id: true, amount: true, receivedAt: true, createdAt: true } },
            designs: { where: { design: { artistId } }, orderBy: { designId: "asc" },
              select: { isFinal: true, design: { select: {
                id: true, title: true, mimeType: true, fileSize: true, createdAt: true, updatedAt: true,
              } } } },
          },
        },
      },
    }), { isolationLevel: "RepeatableRead" });
    if (!record) return Response.json({ error: "not_found" }, { status: 404, headers });

    const { appointments: related, ...client } = record;
    const designs = new Map(related.flatMap(appointment => appointment.designs.map(({ design }) => [design.id, {
      ...design,
      originalUrl: `/api/designs/${encodeURIComponent(design.id)}/image?variant=original`,
      previewUrl: `/api/designs/${encodeURIComponent(design.id)}/image?variant=preview`,
    }] as const)));
    const appointments = related.map(({ payments: _payments, designs: links, ...appointment }) => {
      void _payments;
      return { ...appointment, clientId: client.id, designs: links.map(({ isFinal, design }) => ({ designId: design.id, isFinal })) };
    });
    const payments = related.flatMap(appointment => appointment.payments.map(payment => ({ ...payment, appointmentId: appointment.id })));
    return new Response(JSON.stringify({
      version: 1, scope: "client", exportedAt: new Date().toISOString(), currency: "EUR", timeZone: studioTimeZone,
      client, appointments, payments, designs: Array.from(designs.values()),
    }, null, 2), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tinta-client-data.json"' },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
