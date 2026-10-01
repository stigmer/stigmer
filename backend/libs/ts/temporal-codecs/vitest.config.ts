import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Measured only when a run asks for it (`--coverage.enabled`), so a
    // local run stays as fast as without it. Every source file under
    // `include` counts, a file no test loads at 0%; AST-aware remapping
    // names exactly the executable lines a run missed.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [...coverageConfigDefaults.exclude, "**/__test-utils__/**", "**/__fixtures__/**", "**/__mocks__/**"],
      reporter: ["json", "json-summary"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: [
      // Source imports carry NodeNext-style `.js` extensions; strip them so
      // vitest resolves the sibling `.ts` sources directly (same alias the
      // runner's vitest.config.ts uses for its relative imports).
      {
        find: /^(\..*)\.js$/,
        replacement: "$1",
      },
    ],
  },
});
