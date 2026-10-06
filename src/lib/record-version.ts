// Only canonical server-rendered timestamps can be used as edit baselines.
export function readRecordVersion(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const version = new Date(value);
  return Number.isFinite(version.getTime()) && version.toISOString() === value ? version : null;
}

export function nextRecordVersion(previous: Date): Date {
  // Advance even when two accepted writes occur within the same millisecond.
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export class StaleRecordError extends Error {}
