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
  },
});
