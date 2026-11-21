import { defineConfig } from "vitest/config";

/**
 * The site suite's unit checks: the static server's URL rules, over a
 * temporary folder. They run in Node, before the audit (`npm run test:site`).
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
