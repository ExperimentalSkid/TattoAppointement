import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const artistId = session.user.id;
  const [profile, clients, designs, appointments, payments] = await prisma.$transaction([
    prisma.user.findUniqueOrThrow({ where: { id: artistId }, select: { id: true, name: true, studioName: true, email: true, language: true, createdAt: true } }),
    prisma.client.findMany({ where: { artistId }, orderBy: { createdAt: "asc" } }),
    prisma.design.findMany({ where: { artistId }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, notes: true, originalName: true, mimeType: true, fileSize: true, createdAt: true, updatedAt: true } }),
    prisma.appointment.findMany({ where: { artistId }, orderBy: { startsAt: "asc" }, include: { designs: { where: { design: { artistId } }, select: { designId: true, isFinal: true } } } }),
    prisma.payment.findMany({ where: { artistId, appointment: { artistId } }, orderBy: { receivedAt: "asc" } }),
  ]);
  const date = new Date();
  return new Response(JSON.stringify({ version: 1, exportedAt: date.toISOString(), currency: "EUR", timeZone: "Europe/Madrid", profile, clients, designs, appointments, payments }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tinta-data-${date.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
