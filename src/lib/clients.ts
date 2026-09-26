export type ClientInput = {
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
};

export type ClientInputError =
  | "name_required"
  | "phone_required"
  | "phone_invalid"
  | "email_invalid";

export function normalizePhone(value: string) {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  return hasLeadingPlus ? `+${digits}` : digits;
}

function normalizeOptional(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: unknown) {
  const email = normalizeOptional(value);
  return email ? email.toLowerCase() : null;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseClientInput(body: unknown):
  | { ok: true; data: ClientInput }
  | { ok: false; error: ClientInputError } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "name_required" };
  }

  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phoneRaw = typeof input.phone === "string" ? input.phone : "";
  const phone = normalizePhone(phoneRaw);
  const email = normalizeEmail(input.email);
  const notes = normalizeOptional(input.notes);

  if (!name) {
    return { ok: false, error: "name_required" };
  }

  if (!phone) {
    return { ok: false, error: "phone_required" };
  }

  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 5 || phoneDigits.length > 20) {
    return { ok: false, error: "phone_invalid" };
  }

  if (email && !isValidEmail(email)) {
    return { ok: false, error: "email_invalid" };
  }

  return {
    ok: true,
    data: {
      name,
      phone,
      email,
      notes,
    },
  };
}
