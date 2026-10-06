import { prisma } from "@/lib/prisma";
import { getTintaAdminUserId, isTintaAdminIdentity } from "@/lib/beta-access";
import { isAllowedStudioEmail } from "@/lib/studio-access";

export class ArtistAccessError extends Error {}

const selection = { id: true, email: true, emailVerified: true, activatedAt: true,
  deactivatedAt: true, deletionRequestedAt: true } as const;

/** No records or sessions are removed; identity remains available for own privacy. */
export async function changeArtistAccess(adminId: string, artistId: string, instruction: {
  enabled: boolean; expectedDeactivatedAt: string | null;
}) {
  return prisma.$transaction(async tx => {
    // Erasure, activation and appointment writes take this same advisory lock.
    // Stable ordering also avoids deadlocks between concurrent account changes.
    for (const id of [...new Set([adminId, artistId])].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${id} FOR UPDATE`;
    }
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: selection });
    if (!admin || !isAllowedStudioEmail(admin.email) || !isTintaAdminIdentity(admin)) throw new ArtistAccessError("forbidden");
    if (artistId === adminId || artistId === getTintaAdminUserId()) throw new ArtistAccessError("forbidden");
    const target = await tx.user.findUnique({ where: { id: artistId }, select: selection });
    if (!target) return { status: "not_found" as const };
    if (target.deletionRequestedAt) return { status: "account_changed" as const };
    // An access switch must never replace an invitation or strand a pending user.
    if (!target.activatedAt) return { status: "invitation_required" as const };
    const current = { id: target.id, enabled: !target.deactivatedAt,
      deactivatedAt: target.deactivatedAt?.toISOString() ?? null };
    if (current.deactivatedAt !== instruction.expectedDeactivatedAt) return { status: "access_conflict" as const, artist: current };
    if (current.enabled === instruction.enabled) return { status: "saved" as const, artist: current };
    const deactivatedAt = instruction.enabled ? null : new Date();
    // Access administration is not a profile edit. Preserve its edit version.
    await tx.$executeRaw`UPDATE "user" SET "deactivatedAt" = ${deactivatedAt} WHERE "id" = ${artistId}`;
    return { status: "saved" as const,
      artist: { id: artistId, enabled: instruction.enabled, deactivatedAt: deactivatedAt?.toISOString() ?? null } };
  });
}
