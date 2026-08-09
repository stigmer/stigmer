import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // The `*.a11y.test.tsx`, `*.layout.test.tsx`, and `*.browser.test.ts(x)`
    // suites run in a real browser (contrast/layout rules and pixel APIs —
    // canvas 2D, createImageBitmap — that happy-dom cannot evaluate) via
    // `vitest.a11y.config.ts`. Exclude them here so the fast, browser-free
    // default suite never tries to load them.
    exclude: [
      "**/node_modules/**",
      "**/*.a11y.test.tsx",
      "**/*.layout.test.tsx",
      "**/*.browser.test.ts",
      "**/*.browser.test.tsx",
    ],
    environment: "happy-dom",
    // Never let happy-dom follow a navigation over the real network. An
    // anchor click with target="_blank" (the browser-download flows) becomes
    // a popup navigation whose request happy-dom issues with its INTERNAL
    // Fetch class — a globalThis.fetch stub cannot intercept it; only these
    // settings block it, before any request is created. Unblocked, the stray
    // DNS lookup resolves after its test has returned and the error lands on
    // an unrelated test (the AgentShareList flake in issue #334).
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
