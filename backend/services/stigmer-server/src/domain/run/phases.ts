/**
 * The domain's phase predicates, shared so every consumer names the same
 * sets.
 *
 * isTerminalExecutionPhase answers "will this execution ever run again?"
 * — COMPLETED / FAILED / CANCELLED / TERMINATED. A terminal phase
 * latches, and a tool call its turn never finished is read as stopped.
 *
 * isActiveExecutionPhase answers the opposite question for a session:
 * "is a run of it still alive?" It guards a session's delete and the eval
 * and judge reads, which must still see a turn parked on a person as alive.
 *
 * isWorkingPhase is narrower: "is this run's turn still under way?" It is
 * what a session's status events say (domain/session/events): the session
 * is running while any run of it is pending, in progress or waiting for
 * approval. A paused run is not working (its session reads idle, and a
 * Stigmer client reads PAUSED from the run).
 *
 * keepsSandboxAwake is the idle sweeps' busy check, in both editions: a
 * session's sandbox may sleep unless a run of it is working. A turn parked
 * on a person's answer or a pause needs no sandbox while it waits, which
 * can be days, and the run workflow asks for the sandbox again before it
 * carries the turn on, waking it (temporal/agentexecution/sandbox-wait.ts,
 * stigmer-cloud#1558). Its sandbox keeps its files while it sleeps.
 * Accepted gap: a Pause writes PAUSED before the runner has heard the
 * cancel, so a sweep pass in those seconds can suspend the sandbox while
 * the runner winds the turn down. That is the crash a draining worker
 * already deals the runner: the harness resumes from its last saved step
 * when the turn carries on.
 */
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

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

/**
 * Pending, in progress, waiting for approval, or paused. WAITING_FOR_APPROVAL
 * and PAUSED are deliberately included: the execution is logically alive
 * and expected to resume. Not the idle sweeps' busy check
 * (keepsSandboxAwake), which leaves the last two out.
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

/**
 * The phases in which a run's turn is under way and needs no one
 * (isWorkingPhase). A turn waiting for a person's answer is not working:
 * the session is idle with requires_action until the answer comes
 * (WAITING_PHASES, domain/session/events/transitions.ts).
 */
export const WORKING_PHASES: ReadonlyArray<RunPhase> = [
  RunPhase.RUN_PENDING,
  RunPhase.RUN_IN_PROGRESS,
];

export function isWorkingPhase(phase: RunPhase): boolean {
  return WORKING_PHASES.includes(phase);
}

/** The phase in which a run's turn waits for a person's answer to its asks. */
export const WAITING_PHASES: ReadonlyArray<RunPhase> = [RunPhase.RUN_WAITING_FOR_APPROVAL];

export function isWaitingPhase(phase: RunPhase): boolean {
  return WAITING_PHASES.includes(phase);
}

/** The phase in which a run's turn is paused until a person resumes it. */
export const PAUSED_PHASES: ReadonlyArray<RunPhase> = [RunPhase.RUN_PAUSED];

/**
 * Whether a run in this phase keeps its session's sandbox awake (module
 * header): only while it is working. A parked run's sandbox may sleep; the
 * hosted edition reads the same rule from this export.
 */
export function keepsSandboxAwake(phase: RunPhase): boolean {
  return isWorkingPhase(phase);
}
