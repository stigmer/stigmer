// The e2e run's state file (`.e2e-server-state.json`): what global setup
// records for the workers and for its own teardown, written through the shared
// run-state helpers (@stigmer/test-support/run-state), which stamp it with the
// process that wrote it, so teardown never takes a file a killed earlier run
// left behind for its own (stigmer#1594). The one place the file's path lives.
import * as path from "node:path";
import { readRunState, takeRunState, writeRunState, type RunStateTake } from "@stigmer/test-support/run-state";
import type { ServerState } from "./server-manager";

/** The file's path, for a message that names it. */
export const STACK_STATE_FILE = path.join(import.meta.dirname, "..", ".e2e-server-state.json");

/** Records the stack's state for this run's workers and teardown (global setup). */
export function writeStackState(state: ServerState): void {
  writeRunState(STACK_STATE_FILE, state);
}

/** The state global setup recorded, for a worker: undefined when none was recorded or it does not parse. */
export function readStackState(): ServerState | undefined {
  return readRunState<ServerState>(STACK_STATE_FILE);
}

/** Takes the state file for global teardown: this run's own, or what else was there. */
export function takeStackState(): RunStateTake<ServerState> {
  return takeRunState<ServerState>(STACK_STATE_FILE);
}
