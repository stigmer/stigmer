import { defineConfig } from "@playwright/test";
import { SHOWN_SCALE } from "./src/shown.ts";

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
 *
 * Two projects draw: `gallery`, every scene at one device pixel per CSS
 * pixel, compared at CSS scale; and `shown`, the pictures the site and the
 * docs show (src/shown.ts), drawn at the device scale the site serves and
 * kept apart under tests/__shown__, because the gallery's spec holds its own
 * folder equal to the catalogue.
 */
const PORT = 4179;

/** The comparison both projects make: no pixel may differ, and nothing moves while it is taken. */
const EXACT = { maxDiffPixels: 0, animations: "disabled", caret: "hide" } as const;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a picture that matches on a second try has not matched
  // (scripts/test-integrity.mjs refuses a config that retries).
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    // Dates and numbers render in one locale and zone, wherever the suite runs.
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "gallery",
      testMatch: "gallery.spec.ts",
      snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
      expect: { toHaveScreenshot: { ...EXACT, scale: "css" } },
      use: { deviceScaleFactor: 1 },
    },
    {
      name: "shown",
      testMatch: "shown.spec.ts",
      snapshotPathTemplate: "{testDir}/__shown__/{arg}{ext}",
      expect: { toHaveScreenshot: { ...EXACT, scale: "device" } },
      use: { deviceScaleFactor: SHOWN_SCALE },
    },
  ],
  webServer: {
    command: "npm run gallery:serve",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  outputDir: "test-results",
});
