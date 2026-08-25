// Vitest configuration for the execution-engine suites (Class B), running
// the full execution glob against the local TS server with its engine
// provisioned (Temporal + the unified runner).
//
// The glob replaced the explicit local-ts-execution roster at
// go-server-retirement (D4 #25): roster/glob equality — the Class B half of
// the cutover gate — was reached at #23. The per-entry roster history lives
// in git (vitest.local-ts-execution.config.ts).
//
// Separate from vitest.config.ts so the dependency-light CRUD suites stay
// fast and Temporal-free (DD-002). These suites boot Temporal + the runner
// around the server, so globalSetup also builds the runner and requires the
// `temporal` CLI, and the boot + execution budget is larger.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites-execution/**/*.test.ts"],
    globalSetup: ["./src/harness/global-setup-execution.ts"],
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
