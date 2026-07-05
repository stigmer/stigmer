import { defineConfig } from "vitest/config";

/**
 * Browser-mode accessibility audit config (DD-22).
 *
 * The Session 18 workspace-panel a11y hardening (tree `aria-level`, search
 * `role="status"` live regions, editor `role="tabpanel"` wiring, focus rings,
 * labeled inputs) can only be audited honestly against real layout and paint:
 * axe-core's highest-value rules — `color-contrast` and `target-size` — are
 * no-ops in happy-dom, where the default suite runs. These suites therefore run
 * in a real Chromium via Vitest's Playwright browser provider.
 *
 * Kept as a SEPARATE config (not a `projects` entry) on purpose:
 * - the fast, 2,689-test happy-dom suite (`vitest.config.ts`, `npm test`) and
 *   the unit CI job stay browser-free;
 * - the browser suite is opt-in via `npm run test:a11y` and its own CI job.
 *
 * Only `*.a11y.test.tsx` files are collected here; the default config excludes
 * that same glob so the two suites never overlap.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.a11y.test.tsx"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
