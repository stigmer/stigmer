// Vitest configuration for the cloud execution run (Class B vs the Java
// stigmer-service) — the cloud twin of vitest.execution.config.ts.
//
// globalSetup boots the hermetic environment once per run (the Class A cloud
// story, delegated wholesale) and pays the runner's cold build; each suite
// file's CloudExecutionTarget then connects and provisions its own engine trio
// (runner + mock LLM + MCP fixture), mirroring the per-file boot the local
// execution config documents.
//
// Include-list curation (each exclusion deliberate, the vitest.cloud.config.ts
// convention):
// - schedule-firing is EXCLUDED: it needs the engine but no runner, so the
//   Class A cloud run already picks it up (see vitest.cloud.config.ts) —
//   running it here would only double the nightly signal.
// - open-computer-use is EXCLUDED: a local-only developer gate (macOS
//   accessibility + STIGMER_DESKTOP_TESTS opt-in) that can never run in the
//   headless CI this config exists for.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites-execution/**/*.test.ts"],
    exclude: [
      "src/suites-execution/schedule-firing.conformance.test.ts",
      "src/suites-execution/open-computer-use.conformance.test.ts",
      // EXCLUDED for the same reason as mcpserver-oauth in
      // vitest.cloud.config.ts: its OAuth handshake setup needs
      // STIGMER_OAUTH_REDIRECT_URI on the service, which the hermetic
      // launcher does not yet pass to the JAR. Cloud enablement is an
      // owner-gated follow-up (CW-1 wrap-up, sub-project 20260824.05).
      "src/suites-execution/mcpserver-connect.conformance.test.ts",
    ],
    globalSetup: ["./src/harness/global-setup-cloud-execution.ts"],
    env: {
      CONFORMANCE_TARGET: "cloud-execution",
    },
    // A real execution spans Temporal dispatch + runner pickup + status
    // stream, and cloud RPCs additionally traverse real auth + FGA — keep the
    // local execution budget, which already has headroom for both.
    testTimeout: 120_000,
    // Covers the per-file boot: readiness probe against the shared
    // environment plus the runner's spawn-and-first-poll (its Temporal
    // workflow bundling dominates).
    hookTimeout: 180_000,
    // One multi-tenant service, one global stigmer_runner task queue: files
    // run serially so N suites never race N runners over shared dispatch.
    fileParallelism: false,
  },
});
