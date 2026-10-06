import { getSession } from "@/lib/session";
import { parseProblemReport } from "@/lib/diagnostic-context";
import { consumeDiagnosticRate, DiagnosticBodyError, diagnosticSameOrigin, diagnosticTimeIsRecent,
  readDiagnosticBody, saveProblemReport } from "@/lib/diagnostics";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
  if (!consumeDiagnosticRate(request, "reports")) return Response.json({ error: "rate_limited" }, { status: 429, headers });
  try {
    const report = parseProblemReport(await readDiagnosticBody(request, 24 * 1024));
    if (!report || !diagnosticTimeIsRecent(report.clickedAt) || report.recentEvents.some(event => !diagnosticTimeIsRecent(event.occurredAt))) {
      return Response.json({ error: "invalid_body" }, { status: 400, headers });
    }
    const session = await getSession();
    const artistId = session?.user.id ?? null;
    if (report.workspaceIdAtClick !== artistId) return Response.json({ error: "account_changed", currentWorkspaceId: artistId }, { status: 409, headers });
    if (artistId && !consumeDiagnosticRate(request, "reports", artistId)) return Response.json({ error: "rate_limited" }, { status: 429, headers });
    const result = await saveProblemReport(report, artistId);
    return result.ok ? Response.json({ reference: result.reference }, { headers })
      : Response.json({ error: result.error }, { status: result.error === "conflict" ? 409 : 503, headers });
  } catch (error) {
    const status = error instanceof DiagnosticBodyError ? (error.code === "too_large" ? 413 : 400) : 503;
    return Response.json({ error: error instanceof DiagnosticBodyError ? error.code : "unavailable" }, { status, headers });
  }
}
