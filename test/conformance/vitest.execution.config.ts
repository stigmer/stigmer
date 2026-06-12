// Vitest configuration for the execution-engine suites (Class B).
//
// Separate from vitest.config.ts so the dependency-light CRUD suites stay fast
// and Temporal-free (DD-002). These suites boot Temporal + the TS runner around
// the Go server, so globalSetup also builds the runner and requires the
// `temporal` CLI, and the boot + execution budget is larger. Defaults the target
// to local-go-execution (the only execution-capable target today); a later cloud
// target can run the same files via CONFORMANCE_TARGET.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites-execution/**/*.test.ts"],
    globalSetup: ["./src/harness/global-setup-execution.ts"],
    env: {
      CONFORMANCE_TARGET: process.env.CONFORMANCE_TARGET ?? "local-go-execution",
    },
    // A real execution spans Temporal dispatch + runner pickup + status stream.
    testTimeout: 120_000,
    // Covers Temporal boot + server boot + runner boot in beforeAll.
    hookTimeout: 180_000,
  },
});
