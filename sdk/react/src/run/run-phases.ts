// A run's phase in both spellings: the run record's `RunPhase` and the word
// a turn's `stigmer.run.status` event carries (`TurnPhase`). The terminal
// predicate is re-exported from @stigmer/client so React, Ink and the pure SDK
// logic share one definition; `runPhaseOf` lets a phase read from the
// session's events drive the components that render a `RunPhase`.
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { TurnPhase } from "@stigmer/client";

export { isTerminalPhase } from "@stigmer/client";

const RUN_PHASE_OF: Readonly<Record<TurnPhase, RunPhase>> = {
  pending: RunPhase.RUN_PENDING,
  running: RunPhase.RUN_IN_PROGRESS,
  waiting: RunPhase.RUN_WAITING_FOR_APPROVAL,
  paused: RunPhase.RUN_PAUSED,
  completed: RunPhase.RUN_COMPLETED,
  failed: RunPhase.RUN_FAILED,
  cancelled: RunPhase.RUN_CANCELLED,
  terminated: RunPhase.RUN_TERMINATED,
};

/**
 * The `RunPhase` a turn's phase word names, for the components that render
 * one (`RunPhaseBadge`, `RunProgress`). A word this client does not know
 * reads as `RUN_PHASE_UNSPECIFIED`.
 */
export function runPhaseOf(phase: TurnPhase): RunPhase {
  return RUN_PHASE_OF[phase] ?? RunPhase.RUN_PHASE_UNSPECIFIED;
}
