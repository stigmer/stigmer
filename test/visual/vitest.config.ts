import { defineConfig } from "vitest/config";

/**
 * The visual package's unit checks: the catalogue against the scenario
 * catalogue and the screenshots, and the browser image's pin. They run in
 * Node, before the visual suite (`npm run test:visual`).
 *
 * Only `src/**\/__tests__` is collected: the Playwright spec under tests/
 * is the suite's, run by `playwright test`, and vitest's default globs would
 * collect it too.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/*.test.ts"],
    environment: "node",
  },
});
