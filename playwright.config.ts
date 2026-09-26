import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000/sign-in",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DESIGN_STORAGE_DIR: ".tmp/e2e-designs",
    },
  },
});
