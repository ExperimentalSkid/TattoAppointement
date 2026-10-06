import { getAdminSession } from "@/lib/session";
import { diagnosticSameOrigin, DiagnosticBodyError, readDiagnosticBody } from "@/lib/diagnostics";
import { isInvitationId } from "@/lib/invitation-code";
import { revokeInvitation, InvitationAccessError } from "@/lib/invitations";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAdminSession();
    if (!session) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const { id } = await params;
    const body = await readDiagnosticBody(request, 128);
    if (!isInvitationId(id) || !body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
      return Response.json({ error: "invalid_instruction" }, { status: 400, headers });
    }
    const result = await revokeInvitation(session.user.id, id);
    return result ? Response.json(result, { headers }) : Response.json({ error: "not_found" }, { status: 404, headers });
  } catch (error) {
    if (error instanceof InvitationAccessError) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (error instanceof DiagnosticBodyError) return Response.json({ error: error.code }, { status: error.code === "too_large" ? 413 : 400, headers });
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
