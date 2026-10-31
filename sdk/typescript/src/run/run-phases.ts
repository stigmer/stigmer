// Framework-agnostic execution-phase predicates, and the proto phase in the
// session log's words (`turnPhaseOf`), so a host that reads a Run (the CLI's
// exit summary) reaches the one exit-code table (exit-codes.ts) through
// `exitCodeOf`.
//
// Lives in @stigmer/client (the pure layer) so it is shared by @stigmer/react-sdk and
// @stigmer/ink-ui and usable by pure logic here (e.g. the file-review fold's corpus
// parity test reproduces the server's terminal-phase gate). @stigmer/react-sdk
// re-exports it so its public API is unchanged.

import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { TurnPhase } from "@stigmer/session-log";

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

const TURN_PHASES: ReadonlyMap<RunPhase, TurnPhase> = new Map<RunPhase, TurnPhase>([
  [RunPhase.RUN_PENDING, "pending"],
  [RunPhase.RUN_IN_PROGRESS, "running"],
  [RunPhase.RUN_WAITING_FOR_APPROVAL, "waiting"],
  [RunPhase.RUN_PAUSED, "paused"],
  [RunPhase.RUN_COMPLETED, "completed"],
  [RunPhase.RUN_FAILED, "failed"],
  [RunPhase.RUN_CANCELLED, "cancelled"],
  [RunPhase.RUN_TERMINATED, "terminated"],
]);

/**
 * A run's phase as the session log names a turn's (`stigmer.run.status`);
 * undefined for `RUN_PHASE_UNSPECIFIED`, a run whose phase is not known.
 */
export function turnPhaseOf(phase: RunPhase): TurnPhase | undefined {
  return TURN_PHASES.get(phase);
}
