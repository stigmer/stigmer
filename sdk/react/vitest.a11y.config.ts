import { defineConfig } from "vitest/config";

/**
 * Browser-mode test config: suites that need REAL layout and paint.
 *
 * Two kinds of tests live here, both dishonest anywhere but a real browser:
 *
 * - `*.a11y.test.tsx` — accessibility audits (DD-22). The Session 18
 *   workspace-panel a11y hardening (tree `aria-level`, search `role="status"`
 *   live regions, editor `role="tabpanel"` wiring, focus rings, labeled
 *   inputs) can only be audited against real layout and paint: axe-core's
 *   highest-value rules — `color-contrast` and `target-size` — are no-ops in
 *   happy-dom, where the default suite runs.
 * - `*.layout.test.tsx` — layout-contract regressions (e.g. the provider
 *   container's sizing contract, #260/DD-019), which require a real layout
 *   engine to resolve computed box sizes.
 *
 * Both run in a real Chromium via Vitest's Playwright browser provider.
 *
 * Kept as a SEPARATE config (not a `projects` entry) on purpose:
 * - the fast, 2,689-test happy-dom suite (`vitest.config.ts`, `npm test`) and
 *   the unit CI job stay browser-free;
 * - the browser suite is opt-in via `npm run test:a11y` and its own CI job.
 *
 * Only the two globs above are collected here; the default config excludes
 * the same globs so the two suites never overlap.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.a11y.test.tsx", "src/**/*.layout.test.tsx"],
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
