export const studioTimeZone = "Europe/Madrid";

export function studioLocalInputValue(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: studioTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const values = new Map(parts.map(part => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}T${values.get("hour")}:${values.get("minute")}`;
}

// Resolve the studio's wall-clock time independently of the browser's timezone.
// Server validation rejects missing/repeated minutes at daylight-saving changes.
export function studioTimezoneOffset(value: string) {
  const pseudoUtc = value ? Date.parse(`${value}:00.000Z`) : Date.now();
  if (!Number.isFinite(pseudoUtc)) return NaN;
  const offsets = new Set<number>();
  for (const hours of [-12, 0, 12]) {
    const sample = new Date(pseudoUtc + hours * 3_600_000);
    const minuteStamp = Math.floor(sample.getTime() / 60_000) * 60_000;
    const wallStamp = Date.parse(`${studioLocalInputValue(sample.toISOString())}:00.000Z`);
    offsets.add((minuteStamp - wallStamp) / 60_000);
  }
  for (const offset of offsets) {
    if (!value || studioLocalInputValue(new Date(pseudoUtc + offset * 60_000).toISOString()) === value) return offset;
  }
  return NaN;
}
