/** Transient, same-tab handoff across Google sign-in. Never put this in a URL query. */
const STORAGE_KEY = "tinta.pending-invitation.v1";
const MAX_AGE_MS = 30 * 60 * 1000;
type PendingInvitation = { code: string; identityId: string | null; savedAt: number };

function readStored(): PendingInvitation | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingInvitation>;
    if (typeof value.code !== "string" || !/^[A-Za-z0-9-]{8,128}$/.test(value.code)
      || typeof value.savedAt !== "number" || Date.now() - value.savedAt > MAX_AGE_MS
      || value.savedAt > Date.now() || !(value.identityId === null || typeof value.identityId === "string")) {
      clearPendingInvitation();
      return null;
    }
    return value as PendingInvitation;
  } catch {
    return null;
  }
}

export function clearPendingInvitation() {
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* No persistent fallback for invitation secrets. */ }
}

/** Only the recipient's page reads the fragment; the server never sees its code. */
export function capturePendingInvitation(identityId: string | null): { code: string; preserved: boolean } {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const fragment = hash.get("code");
  let saved = readStored();
  if (saved?.identityId && saved.identityId !== identityId) {
    clearPendingInvitation();
    saved = null;
  }
  let code = saved?.code ?? "";
  if (fragment !== null) {
    // Remove even malformed codes, without sending them to routing or telemetry.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    code = /^[A-Za-z0-9-]{8,128}$/.test(fragment) ? fragment : "";
    clearPendingInvitation();
    saved = null;
  }
  if (!code) return { code: "", preserved: true };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code, identityId, savedAt: saved?.savedAt ?? Date.now() } satisfies PendingInvitation));
    return { code, preserved: true };
  } catch {
    return { code, preserved: false };
  }
}

export function hasPendingInvitation() {
  return Boolean(readStored());
}
