// The CLI's suite keeps vitest's own collection (every *.test.ts outside
// node_modules); this file carries the gate's coverage block and the timeout
// a coverage run needs.
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
    // The marketplace tests read the whole plugin catalogue: about 1 s each on
    // their own, about four times that with coverage on, and slower again on
    // the 4-vCPU CI runner, where three of them passed vitest's 5 s default
    // (6.4, 9.5 and 5.0 s, 2026-10-01). The same headroom sdk/react's config
    // gives its suite for CI load.
    testTimeout: 15_000,
  },
});
