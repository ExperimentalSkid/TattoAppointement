import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/studio-time.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { studioLocalInputValue, studioTimezoneOffset } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
assert.equal(studioLocalInputValue("2026-10-05T08:00:00Z"), "2026-10-05T10:00");
assert.equal(studioTimezoneOffset("2026-01-05T10:00"), -60);
assert.equal(studioTimezoneOffset("2026-07-05T10:00"), -120);
assert.equal(studioTimezoneOffset("2026-03-29T01:30"), -60);
assert.equal(studioTimezoneOffset("2026-03-29T03:30"), -120);
assert.equal(Number.isNaN(studioTimezoneOffset("2026-03-29T02:30")), true);
assert.equal(studioTimezoneOffset("2026-10-25T01:30"), -120);
assert.equal(studioTimezoneOffset("2026-10-25T03:30"), -60);
assert.equal(Number.isNaN(studioTimezoneOffset("2026-02-31T10:00")), true);
console.log("Studio time stays consistent across browser timezones and DST boundaries");
