import { getIdentitySession } from "@/lib/session";
import { diagnosticSameOrigin, DiagnosticBodyError, readDiagnosticBody } from "@/lib/diagnostics";
import { parseInvitationRedemption } from "@/lib/invitation-code";
import { redeemInvitation, InvitationAccessError } from "@/lib/invitations";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request) {
  try {
    const session = await getIdentitySession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (!diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const instruction = parseInvitationRedemption(await readDiagnosticBody(request, 512));
    if (!instruction) return Response.json({ error: "invalid_instruction" }, { status: 400, headers });
    const result = await redeemInvitation(session.user.id, instruction.code);
    if (result.status === "account_paused") return Response.json({ error: "account_paused" }, { status: 403, headers });
    if (result.status === "rate_limited") {
      return Response.json({ error: "INVITATION_RATE_LIMITED", retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { ...headers, "Retry-After": String(result.retryAfterSeconds) } });
    }
    if (result.status === "unavailable") {
      return Response.json({ error: "INVITATION_UNAVAILABLE", message: "This invitation cannot be used. Ask Kim for a new code." }, { status: 400, headers });
    }
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof InvitationAccessError) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (error instanceof DiagnosticBodyError) return Response.json({ error: error.code }, { status: error.code === "too_large" ? 413 : 400, headers });
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
