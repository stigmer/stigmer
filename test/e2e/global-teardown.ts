import * as fs from "node:fs";
import * as path from "node:path";
import { stopBackendStack, type ServerState } from "./fixtures/server-manager";
import { stopMockLlmProxy } from "./fixtures/mock-llm";

const STATE_FILE = path.join(import.meta.dirname, ".e2e-server-state.json");

async function globalTeardown() {
  // Close the mock LLM proxy if this run started one. It lives in this (main)
  // process via a module singleton, so teardown can close the very instance
  // global-setup created. No-op when no proxy was started.
  await stopMockLlmProxy();

  // Stop whatever stack this process started, whether or not setup got as far
  // as the state file: Playwright runs this teardown after a failed setup too,
  // and a setup that failed between the stack's start and the file would
  // otherwise leave the stack holding the API port for the next run (#1594).
  // The stop returns once the port refuses connections.
  const stopped = await stopBackendStack();
  if (stopped) console.log("[e2e] Backend stack stopped, and its API port refuses connections");

  if (!fs.existsSync(STATE_FILE)) return;
  const state: ServerState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  fs.unlinkSync(STATE_FILE);

  if (state.reused) {
    console.log("[e2e] Backend was reused — nothing to tear down");
  } else if (!stopped) {
    // The file recorded a stack this run started, yet this process held none:
    // a "stopped" that stops nothing is what #1594 looked like. The file is
    // already gone, so it cannot fail a later teardown too.
    throw new Error(`[e2e] ${STATE_FILE} recorded a stack this run started, but this process held none to stop`);
  }
}

export default globalTeardown;
