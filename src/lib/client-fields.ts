export const CLIENT_FIELD_LIMITS = {
  name: 120,
  phone: 40,
  email: 254,
  notes: 4000,
} as const;

export type ClientField = keyof typeof CLIENT_FIELD_LIMITS;

export function normalizeClientPhone(value: string) {
  return value.trim().replace(/[\s().-]/g, "");
}

// The basic HTML email syntax accepts local domains as well as dotted domains.
const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function readClientFields(formData: FormData) {
  const raw = {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    notes: String(formData.get("notes") ?? "").replace(/\r\n?/g, "\n"),
  };
  const values = {
    name: raw.name.trim(),
    phone: normalizeClientPhone(raw.phone),
    email: raw.email.trim() || null,
    notes: raw.notes.trim() || null,
  };
  const fields: ClientField[] = [];
  if (!values.name || raw.name.length > CLIENT_FIELD_LIMITS.name) fields.push("name");
  if (!values.phone || raw.phone.length > CLIENT_FIELD_LIMITS.phone) fields.push("phone");
  if (raw.email.length > CLIENT_FIELD_LIMITS.email || (values.email && !emailPattern.test(values.email))) fields.push("email");
  if (raw.notes.length > CLIENT_FIELD_LIMITS.notes) fields.push("notes");
  return { values, fields };
}
