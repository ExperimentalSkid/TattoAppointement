import { getSession } from "@/lib/session";
import { getWorkspaceRevision } from "@/lib/workspace-sync";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: responseHeaders });
  }

  const [revision, artist] = await Promise.all([getWorkspaceRevision(session.user.id), prisma.user.findUnique({ where: { id: session.user.id }, select: { diagnosticsConsent: true, deletionRequestedAt: true } })]);
  if (!artist || artist.deletionRequestedAt) return Response.json({ error: "unauthorized" }, { status: 401, headers: responseHeaders });
  return Response.json({ workspaceId: session.user.id, revision, diagnosticsConsent: artist.diagnosticsConsent }, { headers: responseHeaders });
}
