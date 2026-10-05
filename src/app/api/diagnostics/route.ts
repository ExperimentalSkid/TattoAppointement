import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { parseDiagnosticIntake } from "@/lib/diagnostic-context";
import { consumeDiagnosticRate, DiagnosticBodyError, diagnosticSameOrigin, diagnosticTimeIsRecent,
  readDiagnosticBody, writeClientDiagnostic } from "@/lib/diagnostics";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function POST(request: Request) {
  if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
  if (!consumeDiagnosticRate(request, "diagnostics")) return Response.json({ error: "rate_limited" }, { status: 429, headers });
  try {
    const intake = parseDiagnosticIntake(await readDiagnosticBody(request, 4096));
    if (!intake || !diagnosticTimeIsRecent(intake.event.occurredAt)) return Response.json({ error: "invalid_body" }, { status: 400, headers });
    const session = await getSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const artistId = session.user.id;
    if (intake.workspaceIdAtClick !== artistId) return Response.json({ error: "account_changed" }, { status: 409, headers });
    if (!consumeDiagnosticRate(request, "diagnostics", artistId)) return Response.json({ error: "rate_limited" }, { status: 429, headers });
    const outcome = await prisma.$transaction(async tx => {
      // The preference route uses the same locks: withdrawal finishes after any
      // accepted event and purges it before the next intake can read consent.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${artistId} FOR UPDATE`;
      const actor = await tx.user.findFirst({ where: { id: artistId, deletionRequestedAt: null }, select: { diagnosticsConsent: true } });
      if (!actor) return "unauthorized";
      if (!actor.diagnosticsConsent) return "consent_required";
      return await writeClientDiagnostic(intake.event, artistId) ? "saved" : "unavailable";
    });
    if (outcome === "unauthorized") return Response.json({ error: outcome }, { status: 401, headers });
    if (outcome === "consent_required") return Response.json({ error: outcome }, { status: 403, headers });
    return outcome === "saved" ? Response.json({ reference: intake.event.id }, { status: 202, headers })
      : Response.json({ error: "unavailable" }, { status: 503, headers });
  } catch (error) {
    const status = error instanceof DiagnosticBodyError ? (error.code === "too_large" ? 413 : 400) : 503;
    return Response.json({ error: error instanceof DiagnosticBodyError ? error.code : "unavailable" }, { status, headers });
  }
}
