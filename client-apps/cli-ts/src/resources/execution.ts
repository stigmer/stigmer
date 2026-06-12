// Execution routing seam.
//
// Executions are not addressed through the generic resource registry: agent
// executions (`aex_`) and workflow executions (`wex_`) are served by dedicated
// controllers, and `delete execution` maps to a *cancel*, not a destroy. This
// module owns the ID-prefix detection and the cancel-with-result semantics so
// that the prefix-sniffing logic lives in exactly one place.
//
// Wave 2a establishes the agent-execution path consumed by `delete execution`.
// Wave 2b extends this module with the full agent-vs-workflow routing shared by
// `usage`, `list executions`, and `download`.

import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { CancelAgentExecutionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";

const AGENT_EXECUTION_PREFIX = "aex";
const WORKFLOW_EXECUTION_PREFIX = "wex";

/** True if `ref` is an agent-execution ID (`aex_…` or `aex-…`, case-sensitive). */
export function isAgentExecutionId(ref: string): boolean {
  return hasKindPrefix(ref, AGENT_EXECUTION_PREFIX);
}

/** True if `ref` is a workflow-execution ID (`wex_…` or `wex-…`, case-sensitive). */
export function isWorkflowExecutionId(ref: string): boolean {
  return hasKindPrefix(ref, WORKFLOW_EXECUTION_PREFIX);
}

// Mirrors Go's reference.isResourceIDWithKind: a kind ID prefix followed by
// either separator the backend accepts ("_" canonical, "-" legacy). Matching is
// case-sensitive — "AEX_" is not an execution ID.
function hasKindPrefix(ref: string, prefix: string): boolean {
  const trimmed = ref.trim();
  return trimmed.startsWith(`${prefix}_`) || trimmed.startsWith(`${prefix}-`);
}

// Terminal phases cannot be cancelled; mirrors Go's isTerminalAgentPhase.
const TERMINAL_AGENT_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

export interface CancelExecutionResult {
  readonly execution: AgentExecution;
  /** True when the execution was already terminal, so no cancel was issued. */
  readonly wasAlreadyTerminal: boolean;
}

/**
 * Cancel an agent execution, surfacing whether it was already in a terminal
 * state. Mirrors Go's execution.CancelWithResult: Get first to read the phase,
 * short-circuit if terminal, otherwise issue the cancel. Keeping the Get means
 * the success/already-terminal distinction is decided client-side from
 * authoritative state rather than from the cancel RPC's response alone.
 */
export async function cancelAgentExecution(client: Stigmer, id: string): Promise<CancelExecutionResult> {
  const current = await client.agentExecution.get(id);
  const phase = current.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  if (TERMINAL_AGENT_PHASES.has(phase)) {
    return { execution: current, wasAlreadyTerminal: true };
  }
  const cancelled = await client.agentExecution.cancel(create(CancelAgentExecutionInputSchema, { id }));
  return { execution: cancelled, wasAlreadyTerminal: false };
}

/** Human-readable agent-execution phase, matching Go's execution.FormatPhase. */
export function formatAgentPhase(phase: ExecutionPhase): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_PENDING:
      return "pending";
    case ExecutionPhase.EXECUTION_IN_PROGRESS:
      return "running";
    case ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL:
      return "awaiting-approval";
    case ExecutionPhase.EXECUTION_PAUSED:
      return "paused";
    case ExecutionPhase.EXECUTION_COMPLETED:
      return "completed";
    case ExecutionPhase.EXECUTION_FAILED:
      return "failed";
    case ExecutionPhase.EXECUTION_CANCELLED:
      return "cancelled";
    case ExecutionPhase.EXECUTION_TERMINATED:
      return "terminated";
    default:
      return "unknown";
  }
}
