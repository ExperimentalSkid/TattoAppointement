import { prisma } from "@/lib/prisma";

export type AppointmentConflict = {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  clientName: string;
};

export async function findAppointmentConflicts({
  artistId,
  startsAt,
  durationMinutes,
  excludeAppointmentId,
}: {
  artistId: string;
  startsAt: Date;
  durationMinutes: number;
  excludeAppointmentId?: string;
}): Promise<AppointmentConflict[]> {
  const requestedEnd = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const earliestCandidateStart = new Date(startsAt.getTime() - 24 * 60 * 60_000);

  const candidates = await prisma.appointment.findMany({
    where: {
      artistId,
      status: { not: "CANCELLED" },
      startsAt: {
        gte: earliestCandidateStart,
        lt: requestedEnd,
      },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      client: { select: { name: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  return candidates
    .filter((candidate) => {
      const candidateEnd = new Date(candidate.startsAt.getTime() + candidate.durationMinutes * 60_000);
      return candidate.startsAt < requestedEnd && candidateEnd > startsAt;
    })
    .map((candidate) => ({
      id: candidate.id,
      startsAt: candidate.startsAt,
      durationMinutes: candidate.durationMinutes,
      clientName: candidate.client.name,
    }));
}
