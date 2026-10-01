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
    // Never let happy-dom follow a navigation over the real network. An
    // anchor click (the desktop download) or a `window.location` assignment
    // becomes a navigation whose request happy-dom issues with its INTERNAL
    // Fetch class, which the setup file's fetch guard cannot intercept; only
    // these settings block it. Same settings, same reason, as
    // sdk/react/vitest.config.ts (issue #334).
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
    // Unmount after every test, fail an unmocked network call, and share
    // sdk/react's async-wait allowance: see the setup file.
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@/": new URL("./src/", import.meta.url).pathname,
    },
  },
});
