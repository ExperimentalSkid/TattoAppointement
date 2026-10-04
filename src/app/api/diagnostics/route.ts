import { getSession } from "@/lib/session";
import { parseDiagnosticIntake } from "@/lib/diagnostic-context";
import { consumeDiagnosticRate, DiagnosticBodyError, diagnosticSameOrigin, diagnosticTimeIsRecent,
  readDiagnosticBody, writeClientDiagnostic } from "@/lib/diagnostics";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
  if (!consumeDiagnosticRate(request, "diagnostics")) return Response.json({ error: "rate_limited" }, { status: 429, headers });
  try {
    const intake = parseDiagnosticIntake(await readDiagnosticBody(request, 4096));
    if (!intake || !diagnosticTimeIsRecent(intake.event.occurredAt)) return Response.json({ error: "invalid_body" }, { status: 400, headers });
    const session = await getSession();
    const artistId = session?.user.id ?? null;
    if (intake.workspaceIdAtClick !== artistId) return Response.json({ error: "account_changed" }, { status: 409, headers });
    if (artistId && !consumeDiagnosticRate(request, "diagnostics", artistId)) return Response.json({ error: "rate_limited" }, { status: 429, headers });
    const saved = await writeClientDiagnostic(intake.event, artistId);
    return saved ? Response.json({ reference: intake.event.id }, { status: 202, headers })
      : Response.json({ error: "unavailable" }, { status: 503, headers });
  } catch (error) {
    const status = error instanceof DiagnosticBodyError ? (error.code === "too_large" ? 413 : 400) : 503;
    return Response.json({ error: error instanceof DiagnosticBodyError ? error.code : "unavailable" }, { status, headers });
  }
}
