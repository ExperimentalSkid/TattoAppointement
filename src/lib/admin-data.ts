import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { DIAGNOSTICS_RETENTION_DAYS, readAdminProblemReports } from "@/lib/diagnostics";

const PAGE_SIZE = 50;

export async function getAdminSnapshot(requestedPage = 1) {
  await requireAdminSession();
  return prisma.$transaction(async tx => {
    const [totalUsers, activated, pending, signInsLast7Days] = await Promise.all([
      tx.user.count(),
      tx.user.count({ where: { activatedAt: { not: null }, deletionRequestedAt: null } }),
      tx.user.count({ where: { activatedAt: null, deletionRequestedAt: null } }),
      tx.user.count({ where: { lastSignInAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, deletionRequestedAt: null } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE));
    const page = Math.min(totalPages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
    const records = await tx.user.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: { id: true, name: true, email: true, emailVerified: true, createdAt: true, activatedAt: true,
        lastSignInAt: true, diagnosticsConsent: true, deletionRequestedAt: true,
        _count: { select: { clients: true, designs: true, appointments: true, payments: true } } },
    });
    const ids = records.map(record => record.id);
    const [clientChanges, designChanges, appointmentChanges, invitationRecords] = await Promise.all([
      tx.client.groupBy({ by: ["artistId"], where: { artistId: { in: ids } }, _max: { updatedAt: true } }),
      tx.design.groupBy({ by: ["artistId"], where: { artistId: { in: ids } }, _max: { updatedAt: true } }),
      tx.appointment.groupBy({ by: ["artistId"], where: { artistId: { in: ids } }, _max: { updatedAt: true } }),
      tx.invitation.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
        select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, redeemedAt: true,
          redeemedBy: { select: { name: true, email: true } } } }),
    ]);
    const changes = new Map<string, Date>();
    for (const group of [...clientChanges, ...designChanges, ...appointmentChanges]) {
      const changedAt = group._max.updatedAt;
      if (changedAt && changedAt > (changes.get(group.artistId) ?? new Date(0))) changes.set(group.artistId, changedAt);
    }
    return {
      users: records.map(({ _count, ...record }) => ({ ...record, totals: _count,
        lastRecordChangeAt: changes.get(record.id) ?? null, activity: null })),
      invitations: invitationRecords.map(({ redeemedBy, ...invitation }) => ({ ...invitation,
        redeemedByName: redeemedBy?.name ?? null, redeemedByEmail: redeemedBy?.email ?? null })),
      summary: { artists: totalUsers, activated, pending, signInsLast7Days },
      pagination: { page, pageSize: PAGE_SIZE, totalPages, totalUsers },
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function getAdminReports() {
  await requireAdminSession();
  const reports = await readAdminProblemReports();
  const identities = reports ? await prisma.user.findMany({
    where: { id: { in: [...new Set(reports.flatMap(report => report.artistId ? [report.artistId] : []))] }, deletionRequestedAt: null },
    select: { id: true, name: true, email: true },
  }) : [];
  const artists = new Map(identities.map(artist => [artist.id, artist]));
  return { available: reports !== null, retentionDays: DIAGNOSTICS_RETENTION_DAYS, limit: 50,
    reports: (reports ?? []).filter(report => !report.artistId || artists.has(report.artistId)).map(({ artistId, ...report }) => ({ ...report,
      userName: artistId ? artists.get(artistId)?.name ?? null : null,
      userEmail: artistId ? artists.get(artistId)?.email ?? null : null })),
  };
}
