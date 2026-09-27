import assert from "node:assert/strict";
import { parseLocalDateTime } from "../src/lib/appointments.ts";

const normal = parseLocalDateTime("2026-10-05T10:00", -120, "Europe/Madrid");
assert.equal(normal?.toISOString(), "2026-10-05T08:00:00.000Z");

assert.equal(
  parseLocalDateTime("2026-03-29T02:30", -120, "Europe/Madrid"),
  null,
  "nonexistent spring-DST local time must be rejected",
);

assert.equal(
  parseLocalDateTime("2026-10-25T02:30", -120, "Europe/Madrid"),
  null,
  "repeated autumn-DST local time must be rejected",
);

assert.equal(
  parseLocalDateTime("2026-02-31T10:00", -60, "Europe/Madrid"),
  null,
  "invalid calendar dates must be rejected",
);

assert.equal(parseLocalDateTime("bad-value", -120, "Europe/Madrid"), null);
assert.equal(parseLocalDateTime("2026-10-05T10:00", 9999, "Europe/Madrid"), null);

console.log("Appointment date/time checks passed");
