import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // The `*.a11y.test.tsx` and `*.layout.test.tsx` suites run in a real
    // browser (contrast/layout rules that happy-dom cannot evaluate) via
    // `vitest.a11y.config.ts`. Exclude them here so the fast, browser-free
    // default suite never tries to load them.
    exclude: ["**/node_modules/**", "**/*.a11y.test.tsx", "**/*.layout.test.tsx"],
    environment: "happy-dom",
    // Raises testing-library's suite-wide async timeout (portaled Base UI
    // content mounts asynchronously and flakes under CI load at the 1s
    // default); see the rationale in the setup file.
    setupFiles: ["./vitest.setup.ts"],
    // Headroom above the 4s async-util timeout so a failing wait reports
    // the informative testing-library error (element query + DOM dump)
    // instead of tripping vitest's own 5s default first.
    testTimeout: 15000,
  },
});
