export const REMINDER_TEMPLATE_MAX_LENGTH = 2000;

type ReminderValues = {
  client: string;
  date: string;
  time: string;
  studio: string;
};

export function getDefaultReminderTemplate(locale: "es" | "en"): string {
  return locale === "es"
    ? "Hola {client}, te recordamos tu cita de tatuaje el {date} a las {time} en {studio}. ¡Nos vemos pronto!"
    : "Hi {client}, a reminder about your tattoo appointment on {date} at {time} at {studio}. See you soon!";
}

export function validateReminderTemplate(value: unknown):
  | { ok: true; template: string }
  | { ok: false; error: "empty" | "length" | "placeholder" } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "empty" };
  }
  const normalized = value.replace(/\r\n?/g, "\n");
  if (normalized.length > REMINDER_TEMPLATE_MAX_LENGTH) {
    return { ok: false, error: "length" };
  }

  const template = normalized.trim();
  const withoutPlaceholders = template.replace(/\{(?:client|date|time|studio)\}/g, "");
  if (/[{}]/.test(withoutPlaceholders)) {
    return { ok: false, error: "placeholder" };
  }
  return { ok: true, template };
}

export function renderReminderTemplate(template: string, values: ReminderValues): string {
  return template.replace(/\{(client|date|time|studio)\}/g, (_match, key: keyof ReminderValues) => values[key]);
}

export function getWhatsAppReminderUrl(phone: string, message: string): string | null {
  const formattedPhone = phone.trim();
  if (!/^(?:\+|00)?[0-9][0-9\s().-]*$/.test(formattedPhone)) {
    return null;
  }

  let digits: string;
  if (formattedPhone.startsWith("+")) {
    digits = formattedPhone.slice(1).replace(/[\s().-]/g, "");
  } else if (formattedPhone.startsWith("00")) {
    digits = formattedPhone.slice(2).replace(/[\s().-]/g, "");
  } else {
    const nationalNumber = formattedPhone.replace(/[\s().-]/g, "");
    if (!/^[6789][0-9]{8}$/.test(nationalNumber)) return null;
    digits = `34${nationalNumber}`;
  }

  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
