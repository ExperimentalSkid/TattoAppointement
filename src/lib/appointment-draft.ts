import { APPOINTMENT_NOTES_MAX_LENGTH } from "./appointment-form-model";
import { isAppointmentStatus, type AppointmentStatusValue } from "./appointments";

export type AppointmentDraft = {
  clientId: string; date: string; time: string; status: AppointmentStatusValue;
  designIds: string[]; finalDesignId: string; notes: string; agreedPrice: string;
  depositRequired: string; initialPayment: string; moneyOpen: boolean;
};
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lifetime = 2 * 60 * 60 * 1000;

export function appointmentDraftKey(artistId: string, token: string | null) {
  return token && tokenPattern.test(token) ? `tinta:appointment-draft:${artistId}:${token.toLowerCase()}` : null;
}
export function parseAppointmentDraft(raw: string | null, bookingPath: string): AppointmentDraft | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const stored = JSON.parse(raw);
    const value = stored.values;
    if (stored.version !== 1 || stored.path !== bookingPath || !Number.isFinite(stored.savedAt) || Date.now() - stored.savedAt > lifetime || stored.savedAt > Date.now() + 60_000) return null;
    if (!value || !isAppointmentStatus(value.status) || !Array.isArray(value.designIds) || value.designIds.length > 1000 || value.designIds.some((id: unknown) => typeof id !== "string" || id.length > 128)) return null;
    for (const field of ["clientId", "date", "time", "finalDesignId", "agreedPrice", "depositRequired", "initialPayment"] as const) {
      if (typeof value[field] !== "string" || value[field].length > 128) return null;
    }
    if (typeof value.notes !== "string" || value.notes.length > APPOINTMENT_NOTES_MAX_LENGTH || typeof value.moneyOpen !== "boolean") return null;
    return value as AppointmentDraft;
  } catch { return null; }
}
export function readAppointmentDraft(key: string | null): string | null {
  if (!key || typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
export function storeAppointmentDraft(key: string, bookingPath: string, values: AppointmentDraft) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ version: 1, path: bookingPath, savedAt: Date.now(), values }));
    return true;
  } catch { return false; }
}
export function removeAppointmentDraft(key: string | null) {
  if (!key) return;
  try { window.sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
