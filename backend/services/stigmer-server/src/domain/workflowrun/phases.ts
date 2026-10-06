/**
 * The workflow execution's "will this run ever run again?" predicate —
 * the twin of domain/agentrun/phases.ts `isTerminalExecutionPhase`,
 * stated once so every consumer names the same set: COMPLETED, FAILED,
 * CANCELLED and TERMINATED. PAUSED is NOT terminal (lifecycle.ts:
 * `applyLifecyclePhaseTransition` keeps `completed_at` as-is on a pause
 * and clears it on the way back to IN_PROGRESS), and neither is PENDING.
 *
 * Deliberately distinct from `isWorkflowTerminalPhase` in subscribe.ts,
 * which OMITS TERMINATED — the disclosed Go quirk the subscribe stream
 * ports faithfully as its close set. Do not merge the two; that file's
 * header carries the reason.
 *
 * The first consumer is the runner-credential lane (runnerauth/
 * bound-execution.ts): a run credential is valid while its run may still
 * run, so a terminated workflow's credential must die exactly as a
 * completed one's does.
 */
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";

export function isTerminalWorkflowExecutionPhase(
  phase: RunPhase,
): boolean {
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
