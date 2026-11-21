import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * The site suite: a sample of the built website's pages, served from the
 * static export as the site's host serves them (src/serve-out.ts), audited
 * with axe at a phone width and a desktop width (tests/site.spec.ts).
 *
 * It reads the export the site's build writes (`site/out`) and builds
 * nothing itself: `make test-site` builds the site first, and the docs lane
 * runs it right after its own build. With no export the config stops here
 * with that command, rather than letting Playwright wait on a server that
 * has nothing to serve.
 *
 * The browser is the root workspace's one Playwright Chromium, the one CI's
 * Chromium action installs (.github/actions/playwright-chromium).
 */
const PORT = 4180;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const EXPORT = fileURLToPath(new URL("../../site/out/", import.meta.url));

if (!existsSync(`${EXPORT}index.html`)) {
  throw new Error(`The site's export is missing (${EXPORT}index.html): run \`make test-site\`, which builds it and then runs this suite.`);
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: an audit that passes on a second try has not passed
  // (scripts/test-integrity.mjs refuses a config that retries).
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: ORIGIN,
    browserName: "chromium",
    // Dates and numbers render in one locale and zone, wherever the suite runs.
    locale: "en-US",
    timezoneId: "UTC",
    // The pages are audited at rest. The site's reveal wrappers fade content
    // in as it scrolls into view, so below the fold it sits at opacity 0 and
    // axe would judge the contrast of text half faded in. The site's
    // stylesheet holds every reveal visible and still under reduced motion
    // (site/src/components/ui/motion.tsx), which is the state a visitor's
    // eye reaches once it has scrolled there. Without it axe skips the
    // hidden sections whole: on the home page it checked the contrast of 17
    // elements rather than 165.
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "narrow", use: { viewport: { width: 390, height: 844 } } },
    { name: "wide", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `node src/serve-out.ts ${JSON.stringify(EXPORT)} ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  outputDir: "test-results",
});
