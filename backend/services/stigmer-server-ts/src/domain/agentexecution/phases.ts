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
 */
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

export function isTerminalExecutionPhase(phase: ExecutionPhase): boolean {
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
    case ExecutionPhase.EXECUTION_FAILED:
    case ExecutionPhase.EXECUTION_CANCELLED:
    case ExecutionPhase.EXECUTION_TERMINATED:
      return true;
    default:
      return false;
  }
}

export function isTranscriptTerminalPhase(phase: ExecutionPhase): boolean {
  return (
    phase === ExecutionPhase.EXECUTION_COMPLETED ||
    phase === ExecutionPhase.EXECUTION_FAILED ||
    phase === ExecutionPhase.EXECUTION_CANCELLED
  );
}
