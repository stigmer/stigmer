import * as fs from "node:fs";
import * as path from "node:path";
import { isPortReachable, startBackendStack, type ServerState } from "./fixtures/server-manager";

const STATE_FILE = path.join(__dirname, ".e2e-server-state.json");
const API_PORT = Number(process.env.STIGMER_E2E_API_PORT ?? "7234");

async function globalSetup() {
  const alreadyRunning = await isPortReachable(API_PORT);

  if (alreadyRunning) {
    console.log(`[e2e] Backend already running on :${API_PORT} — reusing`);
    const state: ServerState = { reused: true };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return;
  }

  console.log(`[e2e] Backend not detected on :${API_PORT} — starting full stack`);
  const state = await startBackendStack({ apiPort: API_PORT });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export default globalSetup;
