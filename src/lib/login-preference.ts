export const LOGIN_PREFERENCE_COOKIE = "tinta-remember-login";
export const REMEMBER_LOGIN_SECONDS = 30 * 24 * 60 * 60;
export const MAX_LOGIN_PREFERENCE_BYTES = 128;

export function parseLoginPreference(value: unknown): { remember: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 1 || Object.keys(value)[0] !== "remember" || !("remember" in value) || typeof value.remember !== "boolean") return null;
  return { remember: value.remember };
}

export async function persistLoginPreference(remember: boolean, fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/preferences/login", {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({ remember }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || body?.remember !== remember) {
    throw new Error("Login preference could not be saved.");
  }
}
