import * as fs from "node:fs";
import * as path from "node:path";
import { stopBackendStack, type ServerState } from "./fixtures/server-manager";
import { stopMockLlmProxy } from "./fixtures/mock-llm";

const STATE_FILE = path.join(__dirname, ".e2e-server-state.json");

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
    stopBackendStack(state);
    console.log("[e2e] Backend stack stopped");
  }

  fs.unlinkSync(STATE_FILE);
}

export default globalTeardown;
