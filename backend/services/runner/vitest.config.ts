import { defineConfig } from "vitest/config";

// GitHub Actions (and other CI) sets CI=true. See the poolOptions note below.
const ci = !!process.env.CI;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    // Fail fast (before collection) on a Node that cannot run the runner —
    // without this, the sqlite-importing files die mid-collection with a raw
    // ERR_UNKNOWN_BUILTIN_MODULE (oss#257). See the setup file's header.
    globalSetup: ["./src/__test-utils__/vitest-global-setup.ts"],
    // Several suites drive REAL bash/git subprocesses (the approval hook, the git
    // snapshot/restore capture). Under full file-parallelism these legitimately
    // exceed the 5s default when the CPU is saturated, so give subprocess tests
    // headroom rather than letting load cause false timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // In CI, cap the fork pool. Vitest's default `forks` pool spawns ~numCPU
    // worker processes; because so many of our tests fork their own bash/git
    // children, an unbounded pool oversubscribes a constrained CI runner and
    // starves vitest's main-thread reporter RPC — surfacing as spurious
    // `onTaskUpdate` timeouts rather than real test failures. A small cap trades
    // a little wall-clock for determinism. Local runs (no CI env) keep full
    // parallelism; `CI=1 npm test` reproduces the CI behavior exactly.
    ...(ci ? { poolOptions: { forks: { maxForks: 2 } } } : {}),
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
