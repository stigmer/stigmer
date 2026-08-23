// Vitest configuration for the local-ts roster — the TS server's parity
// gate (stigmer-cloud program 20260822.01, D4).
//
// The include list IS the roster: it grows per domain sub-project until it
// equals vitest.config.ts's full glob — that roster equality is the
// cutover gate. Every listed suite runs UNCHANGED against the TS server;
// capability flags are byte-identical to local-go, so both servers face
// the same assertions.
//
// Roster history:
//   - organization + registry-proxy — sub-project #4 (storage + pipeline;
//     registry-proxy exercises the #3 transport lanes, DD-003).
//   - environment — sub-project #5 (encryption + runnerauth + the
//     Environment domain; the first secret-bearing suite).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/suites/organization.conformance.test.ts",
      "src/suites/registry-proxy.conformance.test.ts",
      "src/suites/environment.conformance.test.ts",
    ],
    globalSetup: ["./src/harness/global-setup-ts.ts"],
    env: {
      CONFORMANCE_TARGET: process.env.CONFORMANCE_TARGET ?? "local-ts",
    },
    // Per-test RPCs are fast; the budget covers retries under load.
    testTimeout: 30_000,
    // Covers server process boot + gRPC readiness gate in beforeAll.
    hookTimeout: 60_000,
  },
});
