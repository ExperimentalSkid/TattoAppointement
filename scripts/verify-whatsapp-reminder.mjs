import assert from "node:assert/strict";
import {
  getDefaultReminderTemplate,
  getWhatsAppReminderUrl,
  REMINDER_TEMPLATE_MAX_LENGTH,
  renderReminderTemplate,
  validateReminderTemplate,
} from "../src/lib/whatsapp-reminder.ts";

assert.equal(REMINDER_TEMPLATE_MAX_LENGTH, 2000);
for (const locale of ["es", "en"]) {
  const template = getDefaultReminderTemplate(locale);
  assert.equal(validateReminderTemplate(template).ok, true);
  for (const placeholder of ["{client}", "{date}", "{time}", "{studio}"]) {
    assert.ok(template.includes(placeholder), `${locale} default includes ${placeholder}`);
  }
}
assert.notEqual(getDefaultReminderTemplate("es"), getDefaultReminderTemplate("en"));

const template = "Hola {client},\nTu cita es el {date} a las {time} en {studio}.\n¡Nos vemos!";
assert.deepEqual(validateReminderTemplate(`  ${template}\n `), { ok: true, template });
assert.deepEqual(validateReminderTemplate(template.replace(/\n/g, "\r\n")), { ok: true, template });
assert.deepEqual(validateReminderTemplate(template.replace(/\n/g, "\r")), { ok: true, template });
assert.deepEqual(validateReminderTemplate("Nos vemos pronto."), { ok: true, template: "Nos vemos pronto." });
assert.deepEqual(validateReminderTemplate("{client} / {client}"), { ok: true, template: "{client} / {client}" });
for (const value of [undefined, null, 42, {}, "", "  \n\t"]) {
  assert.equal(validateReminderTemplate(value).ok, false, `rejects empty/non-text ${String(value)}`);
}
for (const value of ["{name}", "{duration}", "{Client}", "{ client }", "{client", "client}", "{}", "{{client}}", "}{", "{client}{unknown}"]) {
  assert.deepEqual(validateReminderTemplate(value), { ok: false, error: "placeholder" }, `rejects ${value}`);
}
const atLimit = `${"a".repeat(1992)}{client}`;
assert.equal(atLimit.length, 2000);
assert.deepEqual(validateReminderTemplate(atLimit), { ok: true, template: atLimit });
assert.deepEqual(validateReminderTemplate(`${atLimit}a`), { ok: false, error: "length" });
assert.deepEqual(validateReminderTemplate(`${atLimit} `), { ok: false, error: "length" });

const values = { client: "María {studio} & $& $1", date: "5 de enero de 2028", time: "10:15", studio: "Línea & Óleo" };
const message = renderReminderTemplate(template, values);
assert.equal(message, "Hola María {studio} & $& $1,\nTu cita es el 5 de enero de 2028 a las 10:15 en Línea & Óleo.\n¡Nos vemos!");
assert.equal(renderReminderTemplate("{client} / {client} / {studio}", values), "María {studio} & $& $1 / María {studio} & $& $1 / Línea & Óleo");
assert.equal(renderReminderTemplate("Nos vemos pronto.", values), "Nos vemos pronto.");

for (const phone of ["+34 611 000 222", "0034 (611) 000-222", "611.000.222", "711000222", "811000222", "911000222"]) {
  const url = new URL(getWhatsAppReminderUrl(phone, message));
  const expectedNumber = phone.startsWith("7") ? "34711000222" : phone.startsWith("8") ? "34811000222" : phone.startsWith("9") ? "34911000222" : "34611000222";
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.pathname, `/${expectedNumber}`);
  assert.equal(url.searchParams.get("text"), message);
}
assert.equal(new URL(getWhatsAppReminderUrl("+44 7700 900123", "Hello")).pathname, "/447700900123");
assert.equal(new URL(getWhatsAppReminderUrl("0044 7700 900123", "Hello")).pathname, "/447700900123");
assert.equal(new URL(getWhatsAppReminderUrl("+12345678", "Hello")).pathname, "/12345678");
assert.equal(new URL(getWhatsAppReminderUrl("+123456789012345", "Hello")).pathname, "/123456789012345");
const reservedMessage = "¿Hola?\nMaría & Óleo: + # % / = ? $& {time}";
const encoded = getWhatsAppReminderUrl("+34611000222", reservedMessage);
assert.equal(encoded, `https://wa.me/34611000222?text=${encodeURIComponent(reservedMessage)}`);
assert.equal(new URL(encoded).searchParams.get("text"), reservedMessage);
for (const phone of ["", " ", "61100022", "511000222", "447700900123", "+0123456789", "+1234567", "+1234567890123456", "611000222 ext 4", "+34/611000222", "+34+611000222", "+34 611000222?text=other", "https://wa.me/34611000222"]) {
  assert.equal(getWhatsAppReminderUrl(phone, message), null, `does not guess or accept malformed phone ${phone}`);
}

console.log("Manual WhatsApp reminders preserve custom text, validate templates, and encode safe international click-to-chat links.");
