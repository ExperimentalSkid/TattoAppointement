import { CalendarView } from "@/components/calendar-view";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import type { AppointmentStatusValue } from "@/lib/appointments";

function validDateKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; anchor?: string }>;
}) {
  const artistId = await requireArtistId();
  const { locale, dictionary } = await getDictionary();
  const params = await searchParams;
  const mode = params.view === "day" ? "day" : "week";
  const requestedAnchor = validDateKey(params.anchor);
  const anchor = requestedAnchor ?? utcDateKey(new Date());
  const anchorUtc = new Date(`${anchor}T12:00:00.000Z`);
  const rangeStart = new Date(anchorUtc.getTime() - 8 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(anchorUtc.getTime() + 9 * 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      artistId,
      startsAt: {
        gte: rangeStart,
        lt: rangeEnd,
      },
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      status: true,
      client: {
        select: {
          name: true,
          phone: true,
        },
      },
    },
  });

  return (
    <CalendarView
      key={`${mode}-${anchor}`}
      appointments={appointments.map((appointment) => ({
        id: appointment.id,
        startsAtIso: appointment.startsAt.toISOString(),
        durationMinutes: appointment.durationMinutes,
        status: appointment.status as AppointmentStatusValue,
        client: appointment.client,
      }))}
      anchor={anchor}
      anchorProvided={Boolean(requestedAnchor)}
      mode={mode}
      locale={locale}
      copy={dictionary.calendar}
      statuses={dictionary.appointments.statuses}
    />
  );
}
