// Framework-agnostic execution-phase predicates.
//
// Lives in @stigmer/sdk (the pure layer) so it is shared by @stigmer/react and
// @stigmer/ink and usable by pure logic here (e.g. the file-review fold's corpus
// parity test reproduces the server's terminal-phase gate). @stigmer/react
// re-exports it so its public API is unchanged.

import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/**
 * Returns `true` when the given phase represents a final, immutable
 * execution state — no further updates will arrive from the server.
 */
export function isTerminalPhase(phase: RunPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}
