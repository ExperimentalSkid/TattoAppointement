import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { diagnosticSameOrigin, DiagnosticBodyError, readDiagnosticBody } from "@/lib/diagnostics";
import { CLIENT_FIELD_LIMITS } from "@/lib/client-fields";
import { readRecordVersion } from "@/lib/record-version";
import { isPrivacyWriteConflict } from "@/lib/privacy-errors";
import { recordRecoveryErasure } from "@/lib/recovery-erasure";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type ErasureError = "not_found" | "stale" | "confirmation" | "mixed_ownership" | "unauthorized";
class ReviewError extends Error { constructor(readonly code: ErasureError) { super(code); } }

function parseInstruction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = ["confirmation", "expectedVersion", "retentionReviewed", "artworkReviewed"];
  if (Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))) return null;
  if (typeof body.confirmation !== "string" || !body.confirmation || body.confirmation.length > CLIENT_FIELD_LIMITS.name
    || body.retentionReviewed !== true || body.artworkReviewed !== true) return null;
  const expectedVersion = readRecordVersion(typeof body.expectedVersion === "string" ? body.expectedVersion : null);
  return expectedVersion ? { confirmation: body.confirmation, expectedVersion } : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const instruction = parseInstruction(await readDiagnosticBody(request, 2 * 1024));
    if (!instruction) return Response.json({ error: "invalid_instruction" }, { status: 400, headers });
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > 10 * 60_000) {
      return Response.json({ error: "reauthenticate" }, { status: 403, headers });
    }
    const { id } = await params;
    const artistId = session.user.id;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${artistId} FOR UPDATE`;
      const activeArtist = await tx.user.findFirst({ where: { id: artistId, deletionRequestedAt: null }, select: { id: true } });
      if (!activeArtist) throw new ReviewError("unauthorized");
      // Client edits do not acquire the artist advisory lock. Lock the row so a
      // rename/version change cannot slip between the review and deletion.
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${id} AND "artistId" = ${artistId} FOR UPDATE`;
      const client = await tx.client.findFirst({ where: { id, artistId }, select: { name: true, updatedAt: true } });
      if (!client) throw new ReviewError("not_found");
      if (client.updatedAt.getTime() !== instruction.expectedVersion.getTime()) throw new ReviewError("stale");
      if (client.name !== instruction.confirmation) throw new ReviewError("confirmation");

      // These locks also prevent a new FK reference from appearing after the
      // ownership checks. Reject malformed associations instead of cascading a
      // different artist's payment or appointment.
      await tx.$queryRaw`SELECT "id" FROM "Appointment" WHERE "clientId" = ${id} FOR UPDATE`;
      const [foreignAppointment, foreignPayment, foreignArtwork] = await Promise.all([
        tx.appointment.findFirst({ where: { clientId: id, artistId: { not: artistId } }, select: { id: true } }),
        tx.payment.findFirst({ where: { appointment: { clientId: id }, artistId: { not: artistId } }, select: { id: true } }),
        tx.appointmentDesign.findFirst({ where: { appointment: { clientId: id }, design: { artistId: { not: artistId } } }, select: { designId: true } }),
      ]);
      if (foreignAppointment || foreignPayment || foreignArtwork) throw new ReviewError("mixed_ownership");
      await recordRecoveryErasure("client", id);
      await tx.payment.deleteMany({ where: { artistId, appointment: { clientId: id, artistId } } });
      await tx.appointment.deleteMany({ where: { clientId: id, artistId } });
      const removed = await tx.client.deleteMany({ where: { id, artistId, updatedAt: instruction.expectedVersion } });
      if (removed.count !== 1) throw new ReviewError("stale");
      // The artist's shared design library is deliberately retained.
    }, { isolationLevel: "Serializable" });
    return Response.json({ erased: true }, { headers });
  } catch (error) {
    if (error instanceof ReviewError) {
      const status = error.code === "not_found" ? 404 : error.code === "unauthorized" ? 401 : error.code === "confirmation" ? 400 : 409;
      return Response.json({ error: error.code }, { status, headers });
    }
    if (error instanceof DiagnosticBodyError) return Response.json({ error: error.code }, { status: error.code === "too_large" ? 413 : 400, headers });
    if (isPrivacyWriteConflict(error)) {
      return Response.json({ error: "stale" }, { status: 409, headers });
    }
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
