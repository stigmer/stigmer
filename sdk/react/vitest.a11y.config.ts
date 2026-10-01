import { defineConfig } from "vitest/config";

/**
 * Browser-mode test config: suites that need REAL layout, paint, or pixels.
 *
 * Every `*.browser.test.ts(x)` runs here (test/README.md, "The test
 * standard": the browser layer), and three kinds of test carry that word, all
 * dishonest anywhere but a real browser:
 *
 * - `*.a11y.browser.test.tsx` — accessibility audits. The workspace-panel
 *   a11y hardening (tree `aria-level`, search `role="status"` live regions,
 *   editor `role="tabpanel"` wiring, focus rings, labeled inputs) can only be
 *   audited against real layout and paint: axe-core's highest-value rules —
 *   `color-contrast` and `target-size` — are no-ops in happy-dom, where the
 *   default suite runs.
 * - `*.layout.browser.test.tsx` — layout-contract regressions (e.g. the
 *   provider container's sizing contract, #260), which require a real layout
 *   engine to resolve computed box sizes.
 * - any other `*.browser.test.ts(x)` — pixel work (canvas 2D,
 *   createImageBitmap, toBlob encoders — e.g. the attachment vision
 *   preparation). happy-dom returns `null` from `getContext("2d")` and has no
 *   `createImageBitmap`, so these paths can only be proven against a real
 *   rendering engine.
 *
 * All run in a real Chromium via Vitest's Playwright browser provider.
 *
 * Kept as a SEPARATE config (not a `projects` entry) on purpose:
 * - the fast happy-dom suite (`vitest.config.ts`, `npm test`) and
 *   the unit CI job stay browser-free;
 * - the browser suite is opt-in via `npm run test:a11y` and its own CI job.
 *
 * Only the `*.browser.test.*` globs are collected here; the default config
 * excludes the same globs so the two suites never overlap.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.browser.test.ts", "src/**/*.browser.test.tsx"],
    // One file at a time: these tests measure REAL layout, paint, rAF
    // timing, and (since the F-18 tooltip suite) real pointer movement.
    // Parallel files in one headless Chromium contend for the same
    // compositor and starve each other's ResizeObserver/rAF delivery —
    // measured locally as scroll-pin tests failing in whichever file ran
    // beside a heavy neighbor, all green in isolation. The suite is
    // seconds long; determinism buys more than parallelism here.
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
