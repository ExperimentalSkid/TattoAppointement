import { getAdminSession } from "@/lib/session";
import { diagnosticSameOrigin, DiagnosticBodyError, readDiagnosticBody } from "@/lib/diagnostics";
import { parseInvitationCreation } from "@/lib/invitation-code";
import { createInvitation, InvitationAccessError } from "@/lib/invitations";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request) {
  try {
    const session = await getAdminSession();
    if (!session) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const instruction = parseInvitationCreation(await readDiagnosticBody(request, 256));
    if (!instruction) return Response.json({ error: "invalid_instruction" }, { status: 400, headers });
    const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    const result = await createInvitation(session.user.id, instruction.expiresInDays, origin);
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    if (error instanceof InvitationAccessError) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (error instanceof DiagnosticBodyError) return Response.json({ error: error.code }, { status: error.code === "too_large" ? 413 : 400, headers });
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
