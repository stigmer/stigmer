import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    // Several suites drive REAL bash/git subprocesses (the approval hook, the git
    // snapshot/restore capture). Under full file-parallelism these legitimately
    // exceed the 5s default when the CPU is saturated, so give subprocess tests
    // headroom rather than letting load cause false timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    resolve: {
      conditions: ["import", "node"],
    },
  },
  resolve: {
    alias: [
      {
        find: /^(@stigmer\/protos\/.*)\.js$/,
        replacement: "$1",
      },
      {
        find: /^(\..*)\.js$/,
        replacement: "$1",
      },
    ],
  },
});
