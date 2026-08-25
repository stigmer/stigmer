// Vitest configuration for the gRPC conformance suite (Class A: CRUD, no
// Temporal), running the full suite glob against the local TS server.
//
// The glob replaced the explicit local-ts roster at go-server-retirement
// (D4 #25): the roster mechanism existed to grow suite-by-suite toward glob
// equality during the port, and equality was reached at the #24 cutover gate.
// The per-entry roster history lives in git (vitest.local-ts.config.ts).
//
// globalSetup compiles the TS server once per run (expensive cold build);
// each suite file then boots its own server instance in beforeAll, so files
// run in parallel without sharing state.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites/**/*.conformance.test.ts"],
    globalSetup: ["./src/harness/global-setup.ts"],
    env: {
      CONFORMANCE_TARGET: process.env.CONFORMANCE_TARGET ?? "local",
    },
    // Per-test RPCs are fast; the budget covers retries under load.
    testTimeout: 30_000,
    // Covers server process boot + gRPC readiness gate in beforeAll.
    hookTimeout: 60_000,
  },
});
