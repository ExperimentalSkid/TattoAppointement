import { getIdentitySession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { diagnosticSameOrigin, DiagnosticBodyError, readDiagnosticBody } from "@/lib/diagnostics";
import { assertAccountOwnership, completeAccountErasure } from "@/lib/privacy-maintenance";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function POST(request: Request) {
  try {
    const session = await getIdentitySession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const body = await readDiagnosticBody(request, 2 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "invalid_instruction" }, { status: 400, headers });
    const instruction = body as Record<string, unknown>;
    if (Object.keys(instruction).length !== 2 || instruction.retentionReviewed !== true
      || typeof instruction.confirmation !== "string" || instruction.confirmation.length > 254
      || instruction.confirmation.trim().toLowerCase() !== session.user.email.toLowerCase()) {
      return Response.json({ error: "invalid_instruction" }, { status: 400, headers });
    }
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > 10 * 60_000) return Response.json({ error: "reauthenticate" }, { status: 403, headers });
    const artistId = session.user.id;
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${artistId} FOR UPDATE`;
      const active = await tx.user.findFirst({ where: { id: artistId, deletionRequestedAt: null }, select: { id: true } });
      if (!active) throw new Error("account_changed");
      await assertAccountOwnership(tx, artistId);
      await tx.user.update({ where: { id: artistId }, data: { deletionRequestedAt: new Date(), diagnosticsConsent: false } });
      await tx.session.deleteMany({ where: { userId: artistId } });
    }, { isolationLevel: "Serializable" });
    let complete = false;
    try { complete = await completeAccountErasure(artistId); } catch { /* Durable queue retries; never claim completion on a failed cleanup. */ }
    return Response.json({ accepted: true, complete }, { status: complete ? 200 : 202, headers });
  } catch (error) {
    if (error instanceof DiagnosticBodyError) return Response.json({ error: error.code }, { status: error.code === "too_large" ? 413 : 400, headers });
    if (error instanceof Error && ["mixed_ownership", "account_changed"].includes(error.message)) {
      return Response.json({ error: "review_required" }, { status: 409, headers });
    }
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
