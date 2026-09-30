import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
