import { test as base, expect } from "@playwright/test";
import { Pool } from "pg";
import { createHash } from "node:crypto";

try { process.loadEnvFile(".env"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

// Each test represents a fresh single-artist installation. Never reset a real studio.
export const test = base.extend<{ emptyStudio: void }>({
  emptyStudio: [async ({ context }, runTest, testInfo) => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.ALLOW_TEST_DB_RESET !== "true" || !url.pathname.endsWith("_e2e")) {
      throw new Error("Browser QA requires a disposable database ending in _e2e and ALLOW_TEST_DB_RESET=true. Studio databases are never reset.");
    }
    const pool = new Pool({ connectionString: url.href });
    try {
      // Separate disposable installations also have separate test client IPs.
      // Production authentication rate limits remain enabled during browser QA.
      const address = createHash("sha256").update(testInfo.testId).digest();
      await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${address[0]}.${address[1]}.${address[2]}` });
      await pool.query('TRUNCATE TABLE "user", "verification" CASCADE');
      await runTest();
    } finally { await pool.end(); }
  }, { auto: true }],
});
export { expect };
