import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/privacy-config.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { getPrivacyConfig } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const fixture = { PRIVACY_OPERATOR_NAME: "Isolated QA legal operator", PRIVACY_OPERATOR_ADDRESS: "Isolated QA contact address", PRIVACY_OPERATOR_COUNTRY: "ES", PRIVACY_CONTACT_EMAIL: "privacy@qa.local", PRIVACY_SERVER_COUNTRY: "ES", PRIVACY_TRANSFER_NOTICE: "Isolated test facts only; no external processing or provider participates in this test fixture." };
let checks = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); checks++; }
check(getPrivacyConfig({}).isConfigured, false);
check(getPrivacyConfig({}).missingFields.length, 6);
check(getPrivacyConfig(fixture).isConfigured, true);
for (const field of Object.keys(fixture)) {
  check(getPrivacyConfig({ ...fixture, [field]: "" }).missingFields, [field]);
  check(getPrivacyConfig({ ...fixture, [field]: "TODO" }).isConfigured, false);
}
for (const value of ["EU", "UTC", "ES<script>", "Neverland"]) check(getPrivacyConfig({ ...fixture, PRIVACY_SERVER_COUNTRY: value }).isConfigured, false);
check(getPrivacyConfig({ ...fixture, PRIVACY_SERVER_COUNTRY: "España" }).serverCountryCode, "ES");
check(getPrivacyConfig({ ...fixture, PRIVACY_SERVER_COUNTRY: "Spain" }).serverCountryCode, "ES");
check(getPrivacyConfig({ ...fixture, PRIVACY_OPERATOR_NAME: "Tinta" }).isConfigured, false);
for (const value of ["not-an-email", "privacy@example.com", "privacy@domain.invalid", "TODO@company.com"]) check(getPrivacyConfig({ ...fixture, PRIVACY_CONTACT_EMAIL: value }).isConfigured, false);
check(getPrivacyConfig({ ...fixture, PRIVACY_OPERATOR_ADDRESS: "<script>operator</script>" }).isConfigured, false);
check(getPrivacyConfig({ ...fixture, PRIVACY_TRANSFER_NOTICE: "EU hosting" }).isConfigured, false);
console.log(`${checks} privacy notice fact-validation checks passed; presence does not certify legal accuracy.`);
