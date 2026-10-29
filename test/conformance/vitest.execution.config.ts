// Vitest configuration for the execution-engine suites (Class B), running
// the full execution glob against the local TS server with its engine
// provisioned (Temporal + the unified runner).
//
// Every suite file the glob matches runs; there is no roster to keep.
//
// Separate from vitest.config.ts so the dependency-light CRUD suites stay
// fast and Temporal-free. These suites boot Temporal + the runner
// around the server, so globalSetup also builds the runner and requires the
// `temporal` CLI, and the boot + execution budget is larger.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites-execution/**/*.test.ts"],
    globalSetup: ["./src/harness/global-setup-execution.ts"],
    // Judges every test on the RPCs it sent: a `[rpc:...]` tag it never sent
    // fails it (src/harness/rpc-recorder.ts).
    setupFiles: ["./src/harness/rpc-verdict-setup.ts"],
    env: {
      CONFORMANCE_TARGET: process.env.CONFORMANCE_TARGET ?? "local-execution",
    },
    // A real execution spans Temporal dispatch + runner pickup + status stream.
    testTimeout: 120_000,
    // Covers Temporal boot + server boot + runner boot in beforeAll.
    hookTimeout: 180_000,
    // Each execution suite file boots its own Temporal + server + runner stack.
    // Run files serially so N suites don't spin up N concurrent engines — Class B
    // is resource-heavy by nature, and bounding it keeps local + CI runs stable.
    // (Tests within a file still run in order.)
    fileParallelism: false,
  },
});
