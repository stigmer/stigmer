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

  if (!fs.existsSync(STATE_FILE)) return;

  const state: ServerState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

  if (state.reused) {
    console.log("[e2e] Backend was reused — nothing to tear down");
  } else {
    console.log("[e2e] Stopping backend stack...");
    // The state file says this run started a stack; a teardown that finds
    // none to stop must say so, not report a stop it never made (#1594).
    if (!(await stopBackendStack())) {
      // The file goes first, so a stale one cannot fail every later teardown.
      fs.unlinkSync(STATE_FILE);
      throw new Error(
        `[e2e] ${STATE_FILE} recorded a stack this run started, but this process holds none to stop; the file is removed`,
      );
    }
    console.log("[e2e] Backend stack stopped, and its API port refuses connections");
  }

  fs.unlinkSync(STATE_FILE);
}

export default globalTeardown;
