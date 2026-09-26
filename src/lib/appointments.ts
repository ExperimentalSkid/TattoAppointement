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

export function parseLocalDateTime(value: string, timezoneOffsetMinutes: number) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;

  const pseudoUtc = Date.parse(`${value}:00.000Z`);
  if (!Number.isFinite(pseudoUtc) || !Number.isFinite(timezoneOffsetMinutes)) return null;

  const date = new Date(pseudoUtc + timezoneOffsetMinutes * 60_000);
  return Number.isNaN(date.getTime()) ? null : date;
}
