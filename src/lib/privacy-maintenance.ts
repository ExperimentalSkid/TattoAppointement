import { prisma } from "@/lib/prisma";
import { removeArtistDesignFiles, pruneUnreferencedDesignFiles } from "@/lib/design-storage";
import { cleanupDiagnostics, purgeAccountDiagnostics } from "@/lib/diagnostics";
import type { Prisma } from "@/generated/prisma/client";
import { recordMaintenanceStatus } from "@/lib/maintenance-status";
import { recordRecoveryErasure } from "@/lib/recovery-erasure";

export async function assertAccountOwnership(tx: Prisma.TransactionClient, artistId: string) {
  const foreignReference = await tx.appointment.findFirst({ where: {
    OR: [
      { artistId: { not: artistId }, client: { artistId } },
      { artistId, client: { artistId: { not: artistId } } },
      { artistId, payments: { some: { artistId: { not: artistId } } } },
      { artistId: { not: artistId }, payments: { some: { artistId } } },
      { artistId, designs: { some: { design: { artistId: { not: artistId } } } } },
      { artistId: { not: artistId }, designs: { some: { design: { artistId } } } },
    ],
  }, select: { id: true } });
  if (foreignReference) throw new Error("mixed_ownership");
}

/** A durable pending user row survives cleanup failures; access is already revoked. */
export async function completeAccountErasure(artistId: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${artistId}, 0))`;
    await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${artistId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: artistId }, select: { deletionRequestedAt: true } });
    if (!user?.deletionRequestedAt) return false;
    await assertAccountOwnership(tx, artistId);
    await recordRecoveryErasure("account", artistId);
    await removeArtistDesignFiles(artistId);
    if (!await purgeAccountDiagnostics(artistId)) throw new Error("private_cleanup_unavailable");
    await tx.verification.deleteMany({ where: { value: artistId } });
    await tx.user.delete({ where: { id: artistId } });
    return true;
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}

export async function runPrivacyMaintenance() {
  let pendingFailures = 0;
  const withdrawn = await prisma.user.findMany({ where: { diagnosticsConsent: false, diagnosticsPurgeRequestedAt: { not: null }, deletionRequestedAt: null }, take: 10, select: { id: true } });
  for (const user of withdrawn) {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${user.id} FOR UPDATE`;
      const current = await tx.user.findFirst({ where: { id: user.id, diagnosticsConsent: false, diagnosticsPurgeRequestedAt: { not: null } }, select: { id: true } });
      if (current) {
        if (await purgeAccountDiagnostics(user.id, true)) await tx.user.update({ where: { id: user.id }, data: { diagnosticsPurgeRequestedAt: null } });
        else pendingFailures++;
      }
    }, { timeout: 15_000 });
  }
  const pending = await prisma.user.findMany({ where: { deletionRequestedAt: { not: null } },
    orderBy: { deletionRequestedAt: "asc" }, take: 10, select: { id: true } });
  for (const user of pending) {
    try { await completeAccountErasure(user.id); } catch { pendingFailures++; }
  }
  const now = new Date();
  const invitationCutoff = new Date(now.getTime() - 30 * 86_400_000);
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.invitation.deleteMany({ where: { OR: [
      { redeemedAt: { lt: invitationCutoff } }, { revokedAt: { lt: invitationCutoff } },
      { redeemedAt: null, revokedAt: null, expiresAt: { lt: invitationCutoff } },
    ] } }),
    prisma.account.updateMany({ where: { providerId: "google", OR: [
      { accessToken: { not: null } }, { refreshToken: { not: null } }, { idToken: { not: null } },
      { scope: { not: null } }, { accessTokenExpiresAt: { not: null } }, { refreshTokenExpiresAt: { not: null } },
    ] }, data: { accessToken: null, refreshToken: null, idToken: null, scope: null,
      accessTokenExpiresAt: null, refreshTokenExpiresAt: null } }),
    prisma.user.updateMany({ where: { image: { not: null }, accounts: { some: { providerId: "google" } } }, data: { image: null } }),
  ]);
  if (!await cleanupDiagnostics()) throw new Error("diagnostic_retention_unavailable");
  await pruneUnreferencedDesignFiles(async keys => {
    const records = await prisma.design.findMany({ where: { OR: [{ storageKey: { in: keys } }, { previewKey: { in: keys } }] },
      select: { storageKey: true, previewKey: true } });
    return new Set(records.flatMap(record => [record.storageKey, record.previewKey].filter((key): key is string => Boolean(key))));
  });
  if (pendingFailures) console.error("Tinta privacy maintenance: pending cleanup requires retry or operator review.");
  return { pendingFailures };
}

const state = globalThis as typeof globalThis & { tintaPrivacyTimer?: ReturnType<typeof setInterval>; tintaPrivacyRunning?: boolean };
export function startPrivacyMaintenance() {
  if (state.tintaPrivacyTimer || process.env.PRIVACY_MAINTENANCE_ENABLED !== "true") return;
  const tick = async () => {
    if (state.tintaPrivacyRunning) return;
    state.tintaPrivacyRunning = true;
    try {
      const result = await runPrivacyMaintenance();
      await recordMaintenanceStatus(result.pendingFailures ? "degraded" : "ok");
    }
    catch {
      console.error("Tinta privacy maintenance: cleanup failed; will retry. Review private storage and database availability.");
      await recordMaintenanceStatus("failed");
    }
    finally { state.tintaPrivacyRunning = false; }
  };
  state.tintaPrivacyTimer = setInterval(() => { void tick(); }, 15 * 60_000);
  state.tintaPrivacyTimer.unref();
  void tick();
}
