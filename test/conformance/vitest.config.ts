// Vitest configuration for the gRPC conformance suite (Class A: CRUD, no
// Temporal), running the full suite glob against the local TS server.
//
// Every suite file the glob matches runs; there is no roster to keep.
//
// globalSetup compiles the TS server once per run (expensive cold build);
// each suite file then boots its own server instance in beforeAll, so files
// run in parallel without sharing state.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites/**/*.conformance.test.ts"],
    globalSetup: ["./src/harness/global-setup.ts"],
    // Judges every test on the RPCs it sent: a `[rpc:...]` tag it never sent
    // fails it (src/harness/rpc-recorder.ts).
    setupFiles: ["./src/harness/rpc-verdict-setup.ts"],
    env: {
      CONFORMANCE_TARGET: process.env.CONFORMANCE_TARGET ?? "local",
    },
    // Per-test RPCs are fast; the budget covers retries under load.
    testTimeout: 30_000,
    // Covers server process boot + gRPC readiness gate in beforeAll.
    hookTimeout: 60_000,
  },
});
