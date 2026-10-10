/**
 * The domain's TWO deliberately-distinct terminal-phase predicates —
 * package-level functions in Go (subscribe.go / tool_call_settle.go),
 * shared here so every consumer names the same sets.
 *
 * isTerminalExecutionPhase answers "will this execution ever run again?"
 * — COMPLETED / FAILED / CANCELLED / TERMINATED. TERMINATED executions
 * will not run, so their in-flight tool calls must settle and their
 * phase latches.
 *
 * isTranscriptTerminalPhase (Go subscribe.go isTerminalPhase) OMITS
 * TERMINATED: the transcript regression guard uses it so a terminated
 * execution's committed transcript stays protected from free rewrites,
 * and the subscribe stream uses it as its close set (the disclosed
 * never-closes-on-TERMINATED quirk, ported faithfully). Do NOT
 * "harmonize" the two — the difference is deliberate and documented in
 * Go.
 *
 * isActiveExecutionPhase answers the opposite question for a session:
 * "is a run of it still alive?" It guards a session's delete, and it is
 * the busy check of an idle sweep, which must never put a session to
 * sleep while a run is pending, running, waiting on a person, or paused.
 *
 * isWorkingPhase is narrower: "is this run's turn still under way?" It is
 * what a session's status events say (domain/session/events): the session
 * is running while any run of it is pending, in progress or waiting for
 * approval. A paused run is not working (its session reads idle, and a
 * Stigmer client reads PAUSED from the run).
 */
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

export function isTerminalExecutionPhase(phase: RunPhase): boolean {
  switch (phase) {
    case RunPhase.RUN_COMPLETED:
    case RunPhase.RUN_FAILED:
    case RunPhase.RUN_CANCELLED:
    case RunPhase.RUN_TERMINATED:
      return true;
    default:
      return false;
  }
}

export function isTranscriptTerminalPhase(phase: RunPhase): boolean {
  return (
    phase === RunPhase.RUN_COMPLETED ||
    phase === RunPhase.RUN_FAILED ||
    phase === RunPhase.RUN_CANCELLED
  );
}

/**
 * Pending, in progress, waiting for approval, or paused. WAITING_FOR_APPROVAL
 * and PAUSED are deliberately included: the execution is logically alive
 * and expected to resume. The hosted edition counts the same set as a
 * session's active runs.
 */
export function isActiveExecutionPhase(phase: RunPhase): boolean {
  switch (phase) {
    case RunPhase.RUN_PENDING:
    case RunPhase.RUN_IN_PROGRESS:
    case RunPhase.RUN_WAITING_FOR_APPROVAL:
    case RunPhase.RUN_PAUSED:
      return true;
    default:
      return false;
  }
}

/** The phases in which a run's turn is under way (isWorkingPhase). */
export const WORKING_PHASES: ReadonlyArray<RunPhase> = [
  RunPhase.RUN_PENDING,
  RunPhase.RUN_IN_PROGRESS,
  RunPhase.RUN_WAITING_FOR_APPROVAL,
];

export function isWorkingPhase(phase: RunPhase): boolean {
  return WORKING_PHASES.includes(phase);
}
