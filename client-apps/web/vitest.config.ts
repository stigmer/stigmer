import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
