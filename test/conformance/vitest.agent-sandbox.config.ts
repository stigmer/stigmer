// Vitest configuration for the agent-sandbox lane's turn proof
// (src/suites-agent-sandbox): a Stigmer turn that outlives its sandbox pod on a
// real cluster. Run only by scripts/agent-sandbox-live.mjs (`make
// test-agent-sandbox`, the ci.agent-sandbox lane), after the driver's own live
// test and on its kind cluster, with the addresses that script hands it; no
// conformance target, edition or readout collects it (every other config here
// includes src/suites/ or src/suites-execution/, or the unit folders). It is
// not the live class either: it calls no paid provider, only the mock.
//
// One file, its cases in order, against one server it boots itself: a turn
// waits on a pod's boot and, after a forced delete, on the workflow's
// two-minute heartbeat, so the budgets are minutes.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/suites-agent-sandbox/**/*.test.ts"],
    // The conformance clients attribute every RPC to its test and need the
    // verdict setup loaded to do so (src/harness/rpc-recorder.ts).
    setupFiles: ["./src/harness/rpc-verdict-setup.ts"],
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 5 * 60_000,
  },
});
