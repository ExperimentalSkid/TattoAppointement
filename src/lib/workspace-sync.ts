import { prisma } from "@/lib/prisma";

/** Revisions stay decimal strings so JSON never loses BigInt precision. */
export async function getWorkspaceRevision(artistId: string): Promise<string> {
  const workspace = await prisma.workspaceRevision.findUniqueOrThrow({
    where: { artistId },
    select: { revision: true },
  });
  return workspace.revision.toString();
}
