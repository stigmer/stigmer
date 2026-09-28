/**
 * Runner activity result handling — ports the RunnerActivityResult half of
 * pkg/domain/agentexecution/temporal/activities/execute_deep_agent.go.
 *
 * The TS runner returns a plain JSON object: the proto-JSON fields of the
 * slim AgentExecutionStatus (phase, error, pendingApprovals, …) plus
 * non-proto extras (structured_output / final_text). An untyped record
 * preserves all fields — proto and non-proto — across the data converter,
 * exactly Go's map[string]interface{} posture. The tolerant phase
 * extraction (string enum name first, numeric fallback) is a wire
 * contract: proto-JSON serializes enums as names, but numeric payloads
 * have crossed this boundary historically.
 *
 * Bundle-safe (pure proto enum import) — the workflow reads phases from
 * every activity result.
 */
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** Go activities.RunnerActivityResult (map[string]interface{}). */
export type RunnerActivityResult = Record<string, unknown>;

/**
 * Extracts the execution phase from a runner activity result; UNSPECIFIED
 * when missing or unparseable (Go GetPhaseFromResult).
 */
export function getPhaseFromResult(
  result: RunnerActivityResult | null | undefined,
): ExecutionPhase {
  if (result === null || result === undefined) {
    return ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  }
  const phase = result["phase"];
  if (typeof phase === "string") {
    // Proto-JSON uses string enum names; the generated TS enum keys ARE
    // the proto value names, so this lookup is Go's ExecutionPhase_value
    // map exactly.
    const value = (ExecutionPhase as Record<string, unknown>)[phase];
    if (typeof value === "number") {
      return value as ExecutionPhase;
    }
    return ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  }
  if (typeof phase === "number") {
    return phase as ExecutionPhase;
  }
  return ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
}

/** Extracts the error string from a runner activity result (Go GetErrorFromResult). */
export function getErrorFromResult(
  result: RunnerActivityResult | null | undefined,
): string {
  if (result === null || result === undefined) {
    return "";
  }
  const error = result["error"];
  return typeof error === "string" ? error : "";
}

/**
 * The runner reported the turn FAILED (its result's phase), as opposed to
 * the flow breaking around it. The runner has then already persisted the
 * failed transcript with its own explanation rows (the runner's terminal
 * table), so the workflow's failure-path status write carries phase and
 * error only and adds no second explanation (stigmer#980). The message is
 * the one the workflow always threw here, so the parent callback and the
 * workflow failure read as before.
 */
export class RunnerReportedFailure extends Error {
  constructor(runnerError: string) {
    super(`agent execution failed: ${runnerError}`);
    this.name = "RunnerReportedFailure";
  }
}
