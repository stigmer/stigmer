import * as fs from "node:fs";
import * as path from "node:path";
import { stopBackendStack, type ServerState } from "./fixtures/server-manager";

const STATE_FILE = path.join(__dirname, ".e2e-server-state.json");

async function globalTeardown() {
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
