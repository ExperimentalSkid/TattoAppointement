import assert from "node:assert/strict";
import { nextRecordVersion, readRecordVersion } from "../src/lib/record-version.ts";

const baseline = "2026-10-03T12:00:00.000Z";
assert.equal(readRecordVersion(baseline)?.toISOString(), baseline);
for (const invalid of [null, "", "invalid", "2026-10-03", "2026-10-03T12:00:00Z", "2026-02-31T12:00:00.000Z", "2026-10-03T14:00:00.000+02:00", new File(["data"], "version.txt")]) {
  assert.equal(readRecordVersion(invalid), null, "missing or noncanonical edit baselines must be rejected");
}

const previous = readRecordVersion(baseline);
const realNow = Date.now;
try {
  Date.now = () => previous.getTime();
  assert.equal(nextRecordVersion(previous).getTime(), previous.getTime() + 1, "same-millisecond saves must advance the record version");
  Date.now = () => previous.getTime() - 1000;
  assert.equal(nextRecordVersion(previous).getTime(), previous.getTime() + 1, "clock changes must not reuse or reverse a record version");
  Date.now = () => previous.getTime() + 1000;
  assert.equal(nextRecordVersion(previous).getTime(), previous.getTime() + 1000);
} finally {
  Date.now = realNow;
}
console.log("Record-version validation and monotonic update checks passed");
