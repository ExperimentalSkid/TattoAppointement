export type ProfileValidation =
  | { ok: true; name: string; studioName: string | null }
  | { ok: false; error: "name" | "studio" };

const controlCharacters = /[\u0000-\u001f\u007f]/;

export function validateProfile(nameValue: unknown, studioValue: unknown): ProfileValidation {
  if (typeof nameValue !== "string" || typeof studioValue !== "string") return { ok: false, error: "name" };
  const name = nameValue.trim();
  const studioName = studioValue.trim();
  if (!name || name.length > 80 || controlCharacters.test(name)) return { ok: false, error: "name" };
  if (studioName.length > 80 || controlCharacters.test(studioName)) return { ok: false, error: "studio" };
  return { ok: true, name, studioName: studioName || null };
}

export function validatePasswordChange(current: unknown, next: unknown, confirmation: unknown) {
  if (typeof current !== "string" || !current || current.length > 128) return "current";
  const invalid = validateNewPassword(next, confirmation);
  if (invalid) return invalid;
  if (next === current) return "same";
  return null;
}

export function validateNewPassword(next: unknown, confirmation: unknown) {
  if (typeof next !== "string" || next.length < 8 || next.length > 128) return "length";
  if (next !== confirmation) return "match";
  return null;
}
