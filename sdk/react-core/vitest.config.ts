import { coverageConfigDefaults, defineConfig } from "vitest/config";

// The conversation core's hooks render under happy-dom with testing-library,
// as they did in the React kit's suite; nothing here draws, so the suite runs
// on the default pool without the kit's browser and vmForks projects.
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
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    // Never let happy-dom follow a navigation over the real network
    // (issue #334, as in the React kit's suite).
    environmentOptions: {
      happyDOM: {
        settings: {
          navigation: {
            disableMainFrameNavigation: true,
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
          },
        },
      },
    },
    setupFiles: ["./vitest.setup.ts"],
    // Headroom above the 8s async-util timeout so a failing wait reports
    // testing-library's error, not vitest's bare timeout.
    testTimeout: 15000,
  },
});
