// Vitest configuration for the cloud conformance run (Class A vs the Java
// stigmer-service).
//
// globalSetup boots the hermetic environment once per run (Testcontainers
// infra + the service fat JAR — far too heavy for the per-file boot the local
// targets use) and publishes it to workers via env vars; each suite file's
// CloudTarget then just connects.
//
// mcp.conformance.test.ts runs here too: its backend resolver keys off
// CONFORMANCE_TARGET=cloud and points the @stigmer/mcp-server bridge at this
// environment as the primary conformance user (stigmer#202's bridge-vs-cloud
// item — it previously booted the OSS Go server unconditionally and had to be
// excluded to avoid a false green against the wrong backend).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // schedule-firing is the one execution-class suite the cloud run picks
    // up: firing needs the engine (which this environment boots) but no
    // runner and no LLM (fires target a deleted agent and fail inside the
    // tick), so it is the first Class B behavior assertable against cloud —
    // the full runner-backed Class B suites live in the cloud-execution run
    // (vitest.cloud-execution.config.ts).
    include: [
      "src/suites/**/*.conformance.test.ts",
      "src/suites-execution/schedule-firing.conformance.test.ts",
    ],
    globalSetup: ["./src/harness/global-setup-cloud.ts"],
    env: {
      CONFORMANCE_TARGET: "cloud",
    },
    // Files run serially: they share one multi-tenant service, and the
    // organization suite's count/pagination baselines would race across
    // concurrently running files.
    fileParallelism: false,
    // Cloud RPCs traverse real auth + Mongo + FGA; give each test headroom
    // over the local budget.
    testTimeout: 30_000,
    // Covers the per-file readiness probe against the shared environment.
    hookTimeout: 60_000,
  },
});
