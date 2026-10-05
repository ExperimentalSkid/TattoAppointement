import { APPOINTMENT_NOTES_MAX_LENGTH } from "./appointment-form-model";
import { isAppointmentStatus, type AppointmentStatusValue } from "./appointments";

export type AppointmentDraft = {
  expectedVersion?: string;
  clientId: string; date: string; time: string; status: AppointmentStatusValue;
  designIds: string[]; finalDesignId: string; notes: string; agreedPrice: string;
  depositRequired: string; initialPayment: string; moneyOpen: boolean;
};
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const artistPattern = /^[A-Za-z0-9_-]{1,128}$/;
const draftPrefix = "tinta:appointment-draft:";
const lifetime = 2 * 60 * 60 * 1000;
const maxStoredLength = 100_000;
const maxStoredDrafts = 20;
let nextPruneAt = 0;

export function appointmentDraftKey(artistId: string, token: string | null) {
  return artistPattern.test(artistId) && token && tokenPattern.test(token) ? `${draftPrefix}${artistId}:${token.toLowerCase()}` : null;
}
function validDraftKey(key: string | null): key is string {
  if (!key?.startsWith(draftPrefix)) return false;
  const parts = key.slice(draftPrefix.length).split(":");
  return parts.length === 2 && artistPattern.test(parts[0]) && tokenPattern.test(parts[1]);
}
function parseStoredDraft(raw: string | null): { path: string; savedAt: number; values: AppointmentDraft } | null {
  if (!raw || raw.length > maxStoredLength) return null;
  try {
    const stored = JSON.parse(raw);
    const value = stored.values;
    if (stored.version !== 1 || typeof stored.path !== "string" || !/^\/(?:new-appointment|appointments\/[A-Za-z0-9_-]{1,128}\/edit)$/.test(stored.path)
      || !Number.isFinite(stored.savedAt) || Date.now() - stored.savedAt >= lifetime || stored.savedAt > Date.now() + 60_000) return null;
    if (!value || !isAppointmentStatus(value.status) || !Array.isArray(value.designIds) || value.designIds.length > 1000 || value.designIds.some((id: unknown) => typeof id !== "string" || id.length > 128)) return null;
    for (const field of ["clientId", "date", "time", "finalDesignId", "agreedPrice", "depositRequired", "initialPayment"] as const) {
      if (typeof value[field] !== "string" || value[field].length > 128) return null;
    }
    if (typeof value.notes !== "string" || value.notes.length > APPOINTMENT_NOTES_MAX_LENGTH || typeof value.moneyOpen !== "boolean") return null;
    if (value.expectedVersion !== undefined && (typeof value.expectedVersion !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expectedVersion))) return null;
    return { path: stored.path, savedAt: stored.savedAt, values: value as AppointmentDraft };
  } catch { return null; }
}
export function parseAppointmentDraft(raw: string | null, bookingPath: string): AppointmentDraft | null {
  const stored = parseStoredDraft(raw);
  return stored?.path === bookingPath ? stored.values : null;
}
function pruneDrafts(storage: Storage, currentKey: string | null) {
  const retained: Array<{ key: string; savedAt: number }> = [];
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (!key?.startsWith(draftPrefix)) continue;
    const stored = validDraftKey(key) ? parseStoredDraft(storage.getItem(key)) : null;
    if (!stored) storage.removeItem(key);
    else retained.push({ key, savedAt: stored.savedAt });
  }
  retained.sort((a, b) => a.key === currentKey ? -1 : b.key === currentKey ? 1 : b.savedAt - a.savedAt);
  for (const { key } of retained.slice(maxStoredDrafts)) storage.removeItem(key);
  nextPruneAt = Date.now() + 60_000;
}
export function readAppointmentDraft(key: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    if (Date.now() >= nextPruneAt) pruneDrafts(storage, key);
    if (!validDraftKey(key)) return null;
    const raw = storage.getItem(key);
    if (raw && !parseStoredDraft(raw)) { storage.removeItem(key); return null; }
    return raw;
  } catch { return null; }
}
export function storeAppointmentDraft(key: string, bookingPath: string, values: AppointmentDraft) {
  if (!validDraftKey(key) || typeof window === "undefined") return false;
  try {
    const raw = JSON.stringify({ version: 1, path: bookingPath, savedAt: Date.now(), values });
    if (!parseStoredDraft(raw)) return false;
    const storage = window.sessionStorage;
    pruneDrafts(storage, key);
    storage.setItem(key, raw);
    pruneDrafts(storage, key);
    return true;
  } catch { return false; }
}
export function removeAppointmentDraft(key: string | null) {
  if (!validDraftKey(key) || typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
export function clearAppointmentDrafts() {
  if (typeof window === "undefined") return;
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(draftPrefix)) storage.removeItem(key);
    }
    nextPruneAt = 0;
  } catch { /* Storage may be disabled. */ }
}
