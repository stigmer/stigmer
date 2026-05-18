import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke tests for the Stigmer web console.
 *
 * Default target is the production deployment at app.stigmer.ai.
 * Override with the STIGMER_E2E_BASE_URL env var for staging or local.
 *
 * Auth is disabled by default (OSS mode). For cloud deployments
 * requiring OIDC, set STIGMER_E2E_AUTH_ENABLED=true and provide
 * credentials via STIGMER_E2E_USERNAME / STIGMER_E2E_PASSWORD.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }]]
    : "html",

  use: {
    baseURL: process.env.STIGMER_E2E_BASE_URL ?? "https://app.stigmer.ai",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  outputDir: "test-results",
});
