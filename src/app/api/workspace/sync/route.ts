import { getSession } from "@/lib/session";
import { getWorkspaceRevision } from "@/lib/workspace-sync";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: responseHeaders });
  }

  const revision = await getWorkspaceRevision(session.user.id);
  return Response.json({ workspaceId: session.user.id, revision }, { headers: responseHeaders });
}
