export const appointmentStatuses = [
  "PLANNED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export type AppointmentStatusValue = (typeof appointmentStatuses)[number];

export function isAppointmentStatus(value: string): value is AppointmentStatusValue {
  return appointmentStatuses.includes(value as AppointmentStatusValue);
}

function formatLocalMinute(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}`;
}

export function parseLocalDateTime(
  value: string,
  timezoneOffsetMinutes: number,
  timezoneName?: string | null,
) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  if (!Number.isFinite(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 14 * 60) return null;

  const pseudoUtc = Date.parse(`${value}:00.000Z`);
  if (!Number.isFinite(pseudoUtc)) return null;

  const date = new Date(pseudoUtc + timezoneOffsetMinutes * 60_000);
  if (Number.isNaN(date.getTime())) return null;

  if (timezoneName) {
    try {
      if (formatLocalMinute(date, timezoneName) !== value) return null;

      // Reject repeated wall-clock minutes during the autumn DST transition.
      // The artist should choose an unambiguous time rather than silently storing
      // one of two possible instants.
      for (let deltaMinutes = -180; deltaMinutes <= 180; deltaMinutes += 15) {
        if (deltaMinutes === 0) continue;
        const alternate = new Date(date.getTime() + deltaMinutes * 60_000);
        if (formatLocalMinute(alternate, timezoneName) === value) return null;
      }
    } catch {
      return null;
    }
  }

  return date;
}

export function appointmentEnd(startsAt: Date, durationMinutes: number) {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

export function appointmentsOverlap(
  firstStart: Date,
  firstDurationMinutes: number,
  secondStart: Date,
  secondDurationMinutes: number,
) {
  const firstEnd = appointmentEnd(firstStart, firstDurationMinutes);
  const secondEnd = appointmentEnd(secondStart, secondDurationMinutes);
  return firstStart < secondEnd && secondStart < firstEnd;
}
