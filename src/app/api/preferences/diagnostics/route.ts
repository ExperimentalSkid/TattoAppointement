import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getPrivacyConfig } from "@/lib/privacy-config";
import { DiagnosticBodyError, diagnosticSameOrigin, purgeAccountDiagnostics, readDiagnosticBody } from "@/lib/diagnostics";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const noticeVersion = "2026-10-05";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const body = await readDiagnosticBody(request, 128);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
      || !("enabled" in body) || typeof body.enabled !== "boolean") {
      return Response.json({ error: "invalid_body" }, { status: 400, headers });
    }
    const enabled = body.enabled;
    if (enabled && !getPrivacyConfig().isConfigured) {
      return Response.json({ error: "privacy_not_configured" }, { status: 409, headers });
    }
    const artistId = session.user.id;
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${artistId} FOR UPDATE`;
      const actor = await tx.user.findFirst({ where: { id: artistId, deletionRequestedAt: null }, select: { id: true, diagnosticsPurgeRequestedAt: true } });
      if (!actor) return null;
      if (enabled && actor.diagnosticsPurgeRequestedAt && !await purgeAccountDiagnostics(artistId, true)) {
        await tx.user.update({ where: { id: artistId }, data: { diagnosticsConsent: false } });
        return { enabled: false, purged: false };
      }
      await tx.user.update({ where: { id: artistId }, data: {
        diagnosticsConsent: enabled, diagnosticsConsentUpdatedAt: new Date(), diagnosticsConsentNoticeVersion: noticeVersion,
        diagnosticsPurgeRequestedAt: enabled ? null : actor.diagnosticsPurgeRequestedAt ?? new Date(),
      } });
      // Persist withdrawal and the maintenance retry flag even if storage is
      // unavailable. Reports and necessary server logs are retained.
      const purged = enabled || await purgeAccountDiagnostics(artistId, true);
      if (!enabled && purged) await tx.user.update({ where: { id: artistId }, data: { diagnosticsPurgeRequestedAt: null } });
      return { enabled, purged };
    }, { timeout: 15_000 });
    if (!result) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    return Response.json({ enabled: result.enabled, workspaceId: artistId, ...(!result.purged ? { error: "cleanup_unavailable" } : {}) },
      { status: result.purged ? 200 : 503, headers });
  } catch (error) {
    const status = error instanceof DiagnosticBodyError ? (error.code === "too_large" ? 413 : 400) : 503;
    return Response.json({ error: error instanceof DiagnosticBodyError ? error.code : "unavailable" }, { status, headers });
  }
}
