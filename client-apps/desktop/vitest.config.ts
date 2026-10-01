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
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    // Never let happy-dom follow a navigation over the real network; only
    // these settings block the requests its internal Fetch would make. Same
    // settings, same reason, as sdk/react/vitest.config.ts (issue #334).
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
    // Unmount after every test, drop the Tauri IPC mock, fail an unmocked
    // network call, and share sdk/react's async-wait allowance: see the
    // setup file.
    setupFiles: ["./vitest.setup.ts"],
  },
});
