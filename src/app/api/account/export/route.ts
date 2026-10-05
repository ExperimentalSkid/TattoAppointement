import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { exportAccountDiagnostics } from "@/lib/diagnostics";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const artistId = session.user.id;
  const logs = await exportAccountDiagnostics(artistId);
  if (!logs) return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const [profile, clients, designs, appointments, payments, accounts, sessions] = await prisma.$transaction([
    prisma.user.findUniqueOrThrow({ where: { id: artistId }, select: { id: true, name: true, studioName: true, email: true, emailVerified: true, image: true, language: true, whatsappReminderTemplate: true, createdAt: true, updatedAt: true, diagnosticsConsent: true, diagnosticsConsentUpdatedAt: true, diagnosticsConsentNoticeVersion: true } }),
    prisma.client.findMany({ where: { artistId }, orderBy: { createdAt: "asc" } }),
    prisma.design.findMany({ where: { artistId }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, notes: true, originalName: true, mimeType: true, fileSize: true, createdAt: true, updatedAt: true } }),
    prisma.appointment.findMany({ where: { artistId, client: { artistId } }, orderBy: { startsAt: "asc" }, include: { designs: { where: { design: { artistId } }, select: { designId: true, isFinal: true } } } }),
    prisma.payment.findMany({ where: { artistId, appointment: { artistId, client: { artistId } } }, orderBy: { receivedAt: "asc" } }),
    prisma.account.findMany({ where: { userId: artistId }, select: { providerId: true, accountId: true, createdAt: true, updatedAt: true } }),
    prisma.session.findMany({ where: { userId: artistId }, select: { id: true, ipAddress: true, userAgent: true, createdAt: true, updatedAt: true, expiresAt: true } }),
  ]);
  const date = new Date();
  const artwork = designs.map(design => ({ ...design, originalUrl: `/api/designs/${design.id}/image?variant=original` }));
  return new Response(JSON.stringify({ version: 1, exportedAt: date.toISOString(), currency: "EUR", timeZone: "Europe/Madrid", profile, clients, designs: artwork, appointments, payments, accounts, sessions, ...logs }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tinta-data-${date.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
