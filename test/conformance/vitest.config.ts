// Vitest configuration for the gRPC conformance suite.
//
// globalSetup builds the Go server binary once per run (expensive cold build);
// each suite file then boots its own server instance in beforeAll, so files
// run in parallel without sharing state.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites/**/*.conformance.test.ts"],
    globalSetup: ["./src/harness/global-setup.ts"],
    // Per-test RPCs are fast; the budget covers retries under load.
    testTimeout: 30_000,
    // Covers server process boot + gRPC readiness gate in beforeAll.
    hookTimeout: 60_000,
  },
});
