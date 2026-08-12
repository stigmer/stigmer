import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests for the Stigmer web console, split into three tiers:
 *
 * - **smoke**: lightweight checks that work against any deployment (including
 *   production behind auth). Validates page loads, absence of error banners,
 *   and HTTP status codes. Run post-deploy via `make test-e2e-smoke`.
 *
 * - **functional**: content assertions that require the full app rendering
 *   (dashboard heading, session composer input, 404 page). These run against
 *   a local dev server via `make test-e2e`.
 *
 * - **interactive**: tests that require the full backend stack (stigmer-server,
 *   Temporal, unified runner). Create real resources via API, verify they render
 *   correctly, and exercise complete user flows. No Makefile target — run
 *   `npm run test:interactive` in test/e2e (global-setup boots the stack
 *   when nothing is listening on the API port).
 *
 * - **interactive-approval**: the HITL approval/disclosure flow, made
 *   deterministic by a mock LLM proxy wired into the runner (opt-in via
 *   STIGMER_E2E_MOCK_LLM). The proxy is a single shared FIFO, so this project
 *   runs SERIAL (`fullyParallel: false`; `make test-e2e-approval` pins
 *   `--workers=1`). Specs skip gracefully when the mock control URL is absent.
 *   Run via `make test-e2e-approval`.
 *
 * Override the target with STIGMER_E2E_BASE_URL for staging or local.
 * When no STIGMER_E2E_BASE_URL is set, Playwright auto-starts the local
 * dev server and defaults to http://localhost:3000.
 */
const isExternalTarget = !!process.env.STIGMER_E2E_BASE_URL;
const baseURL = process.env.STIGMER_E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }]]
    : "html",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "smoke",
      testDir: "./tests/smoke",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "functional",
      testDir: "./tests/functional",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "interactive",
      testDir: "./tests/interactive",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "interactive-approval",
      testDir: "./tests/interactive-approval",
      // The mock LLM proxy is a single shared FIFO queue, so the gated specs
      // must not interleave. `make test-e2e-approval` additionally pins
      // `--workers=1` to enforce single-consumer ordering across files.
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",

  webServer: !isExternalTarget
    ? {
        command: "npm run dev -w client-apps/web",
        cwd: "../..",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60_000,
        // A local e2e stack must run in OSS no-auth mode against the e2e server,
        // regardless of a developer's personal client-apps/web/.env (which may
        // point at prod Auth0/OIDC). @next/env does not override variables that
        // are already present in process.env, so these win over the .env file.
        // Only applies to the locally-spawned dev server — external targets
        // (STIGMER_E2E_BASE_URL) skip webServer entirely.
        env: {
          NEXT_PUBLIC_AUTH_MODE: "disabled",
          NEXT_PUBLIC_API_URL: `http://localhost:${process.env.STIGMER_E2E_API_PORT ?? "7234"}`,
        },
      }
    : undefined,

  outputDir: "test-results",
});
