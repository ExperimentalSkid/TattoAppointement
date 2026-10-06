import { getAdminSession } from "@/lib/session";
import { isArtistAccessId, parseArtistAccessChange } from "@/lib/beta-access";
import { ArtistAccessError, changeArtistAccess } from "@/lib/artist-access";
import { diagnosticSameOrigin, DiagnosticBodyError, readDiagnosticBody } from "@/lib/diagnostics";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAdminSession();
    if (!admin || !diagnosticSameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const { id } = await params;
    const instruction = parseArtistAccessChange(await readDiagnosticBody(request, 256));
    if (!isArtistAccessId(id) || !instruction) return Response.json({ error: "invalid_instruction" }, { status: 400, headers });
    const result = await changeArtistAccess(admin.user.id, id, instruction);
    if (result.status === "saved") return Response.json({ artist: result.artist }, { headers });
    if (result.status === "not_found") return Response.json({ error: "not_found" }, { status: 404, headers });
    return Response.json({ error: result.status, ...("artist" in result ? { artist: result.artist } : {}) }, { status: 409, headers });
  } catch (error) {
    if (error instanceof ArtistAccessError) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (error instanceof DiagnosticBodyError) return Response.json({ error: error.code }, { status: error.code === "too_large" ? 413 : 400, headers });
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
