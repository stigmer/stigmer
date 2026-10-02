import { stopBackendStack } from "./fixtures/server-manager";
import { stopMockLlmProxy } from "./fixtures/mock-llm";
import { STACK_STATE_FILE, takeStackState } from "./fixtures/stack-state";

async function globalTeardown() {
  // Close the mock LLM proxy if this run started one. It lives in this (main)
  // process via a module singleton, so teardown can close the very instance
  // global-setup created. No-op when no proxy was started.
  await stopMockLlmProxy();

  // Take the state file first, so this run's own is gone even when the stop
  // below throws. Only a file this process wrote is this run's; one a killed
  // earlier run left is removed as stale and judged no further (#1594).
  const taken = takeStackState();

  // Stop whatever stack this process started, whether or not setup got as far
  // as the state file: Playwright runs this teardown after a failed setup too,
  // and a setup that failed between the stack's start and the file would
  // otherwise leave the stack holding the API port for the next run (#1594).
  // The stop returns once the port refuses connections.
  const stopped = await stopBackendStack();
  if (stopped) console.log("[e2e] Backend stack stopped, and its API port refuses connections");

  switch (taken.kind) {
    case "none":
      return;
    case "stale":
      console.log(
        `[e2e] Removed ${STACK_STATE_FILE}, left by a run that has exited` +
          (taken.writerPid === undefined ? "" : ` (pid ${taken.writerPid})`),
      );
      return;
    case "live-elsewhere":
      console.log(`[e2e] ${STACK_STATE_FILE} belongs to a run still going (pid ${taken.writerPid}); left in place`);
      return;
    case "own":
      if (taken.state.reused) {
        console.log("[e2e] Backend was reused — nothing to tear down");
      } else if (!stopped) {
        // This run's setup recorded a stack it started, yet this process held
        // none: a "stopped" that stops nothing is what #1594 looked like.
        throw new Error(`[e2e] ${STACK_STATE_FILE} recorded a stack this run started, but this process held none to stop`);
      }
  }
}

export default globalTeardown;
