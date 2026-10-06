import { readFile } from "node:fs/promises";
import ts from "typescript";
try { process.loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const source = await readFile(new URL("../src/lib/privacy-config.ts", import.meta.url), "utf8");
const compiledSource = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { getPrivacyConfig } = await import(`data:text/javascript;base64,${Buffer.from(compiledSource).toString("base64")}`);
const configuration = getPrivacyConfig();
if (!configuration.isConfigured) {
  console.error(`Privacy publication facts are incomplete: ${configuration.missingFields.join(", ")}.`);
  process.exitCode = 1;
} else console.log("Required privacy fields are present. Verify their accuracy, artist/provider agreements, transfers, rights contact and backup procedure before publication. This check does not certify compliance.");
