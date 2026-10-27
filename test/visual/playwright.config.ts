import { defineConfig } from "@playwright/test";

/**
 * The visual suite: every scene of the kit's gallery compared with its
 * approved screenshot and audited with axe (tests/gallery.spec.ts).
 *
 * Pixels are only comparable when one machine draws them, so every picture
 * is drawn by the browser of one pinned image (playwright-image.json). In CI
 * the job runs inside that image. On a workstation `make test-visual` starts
 * the same image as a browser server and points this config at it through
 * Playwright's own `PW_TEST_CONNECT_WS_ENDPOINT`, with
 * `PW_TEST_CONNECT_EXPOSE_NETWORK=<loopback>` so the remote browser reaches
 * the gallery served here; nothing in this file branches on where it runs.
 *
 * The comparison allows no difference: one pinned browser draws the same
 * pixels every time, and a tolerance is how a lost 1px border went unseen
 * three times (test/e2e/tests/interactive-approval/tool-card-ux.spec.ts).
 * Baselines carry no platform suffix, since there is one drawing platform.
 */
const PORT = 4179;

export default defineConfig({
  testDir: "./tests",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a picture that matches on a second try has not matched
  // (scripts/test-integrity.mjs refuses a config that retries).
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: { maxDiffPixels: 0, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    deviceScaleFactor: 1,
    // Dates and numbers render in one locale and zone, wherever the suite runs.
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run gallery:serve",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  outputDir: "test-results",
});
