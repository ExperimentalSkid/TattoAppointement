import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isTintaAdminIdentity } from "@/lib/beta-access";
import { createInvitationCode, hashInvitationCode, invitationAttemptState } from "@/lib/invitation-code";
import { isAllowedStudioEmail } from "@/lib/studio-access";

export class InvitationAccessError extends Error {}

const identitySelection = { id: true, email: true, emailVerified: true, activatedAt: true, deletionRequestedAt: true } as const;
const invitationSelection = { id: true, createdAt: true, expiresAt: true, revokedAt: true, redeemedAt: true } as const;

async function lockIdentity(tx: Prisma.TransactionClient, userId: string) {
  // Account erasure takes the same advisory lock and user-row lock. Redemption
  // cannot reactivate or spend an invitation for an identity being erased.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
  await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${userId} FOR UPDATE`;
  return tx.user.findUnique({ where: { id: userId }, select: identitySelection });
}

async function lockAdmin(tx: Prisma.TransactionClient, adminId: string) {
  const admin = await lockIdentity(tx, adminId);
  if (!admin || !isAllowedStudioEmail(admin.email) || !isTintaAdminIdentity(admin)) throw new InvitationAccessError("forbidden");
}

/** The raw code exists only in this creation result and is never logged. */
export async function createInvitation(adminId: string, expiresInDays: number, origin: string) {
  const code = createInvitationCode();
  const codeHash = hashInvitationCode(code)!;
  const invitation = await prisma.$transaction(async tx => {
    await lockAdmin(tx, adminId);
    const now = new Date();
    return tx.invitation.create({ data: { codeHash, createdById: adminId, createdAt: now,
      expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000) }, select: invitationSelection });
  });
  return { invitation, code, link: `${origin}/join#code=${encodeURIComponent(code)}` };
}

export async function revokeInvitation(adminId: string, invitationId: string) {
  return prisma.$transaction(async tx => {
    await lockAdmin(tx, adminId);
    // The guarded UPDATE and redemption's guarded UPDATE contend on the same
    // row, so only one state transition can win even across server processes.
    const result = await tx.invitation.updateMany({ where: { id: invitationId, revokedAt: null, redeemedAt: null },
      data: { revokedAt: new Date() } });
    if (result.count) return { status: "revoked" as const };
    const current = await tx.invitation.findUnique({ where: { id: invitationId }, select: { revokedAt: true, redeemedAt: true } });
    if (!current) return null;
    return { status: current.redeemedAt ? "already_redeemed" as const : "already_revoked" as const };
  });
}

export async function redeemInvitation(userId: string, code: string) {
  const codeHash = hashInvitationCode(code);
  return prisma.$transaction(async tx => {
    const user = await lockIdentity(tx, userId);
    if (!user || user.deletionRequestedAt || !isAllowedStudioEmail(user.email)) throw new InvitationAccessError("unauthorized");
    if (user.activatedAt) return { status: "already_active" as const };

    const now = new Date();
    const previous = await tx.invitationAttemptWindow.findUnique({ where: { userId } });
    const attempt = invitationAttemptState(previous, now);
    if (!attempt.allowed) return { status: "rate_limited" as const, retryAfterSeconds: attempt.retryAfterSeconds };
    await tx.invitationAttemptWindow.upsert({ where: { userId },
      create: { userId, windowStartedAt: attempt.windowStartedAt, attempts: attempt.attempts },
      update: { windowStartedAt: attempt.windowStartedAt, attempts: attempt.attempts } });
    if (!codeHash) return { status: "unavailable" as const };

    const redeemed = await tx.invitation.updateMany({ where: { codeHash, expiresAt: { gt: now }, revokedAt: null, redeemedAt: null },
      data: { redeemedAt: now, redeemedById: userId } });
    if (redeemed.count !== 1) return { status: "unavailable" as const };
    await tx.user.update({ where: { id: userId }, data: { activatedAt: now } });
    await tx.invitationAttemptWindow.delete({ where: { userId } });
    return { status: "activated" as const };
  });
}
