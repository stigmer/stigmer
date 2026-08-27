/**
 * Status-transition hook types — the execution-lifecycle seam of the
 * convergence blueprint (20260826.02 blueprint/03 §7, DD-006 §3), carried
 * by the extension registry from O1 (20260826.09) and CONSUMED by O4 at
 * the updateStatus chokepoint (src/domain/agentexecution/update-status.ts,
 * the single merge point every status transition funnels through).
 *
 * The ratified contract, verbatim: observers fire synchronously after the
 * store write and MAY NOT mutate the execution; decorators may contribute
 * only response fields the OSS reply schema already carries (the
 * control-signal field exists on the shared proto); StreamBroker.broadcast
 * stays last. The workflow `stigmer/agent-execution/invoke` stays
 * byte-identical — no extension activities inside it (the rejected
 * alternative in DD-006).
 *
 * Scope note (ratified census finding): this hook family spans the
 * agent-execution family ONLY. Workflowexecution is unmetered in the cloud
 * edition, and no hook is built ahead of need there.
 */
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UpdateStatusResponse } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

/** One observed phase transition, delivered post-merge (blueprint §7). */
export interface AgentExecutionStatusTransition {
  /** The merged, persisted execution snapshot. Observers may not mutate it. */
  readonly execution: AgentExecution;
  readonly oldPhase: ExecutionPhase;
  readonly newPhase: ExecutionPhase;
}

/**
 * Fires synchronously after the merge persists. A throwing observer is an
 * extension bug logged by the chokepoint, never a failed transition — the
 * cloud's expiry sweep remains the reconciliation backstop it already is.
 */
export type AgentExecutionStatusObserver = (
  transition: AgentExecutionStatusTransition,
) => void | Promise<void>;

/**
 * Runs after the merge, before the reply; may set only fields the shared
 * reply schema carries. Decorator failure degrades the contributed fields
 * to their defaults (the verified non-fatal posture), never the RPC.
 */
export type AgentExecutionResponseDecorator = (
  execution: AgentExecution,
  response: UpdateStatusResponse,
) => void | Promise<void>;

/** The hook bundle one extension unit contributes (both lists optional). */
export interface AgentExecutionStatusHooks {
  readonly observers?: ReadonlyArray<AgentExecutionStatusObserver>;
  readonly responseDecorators?: ReadonlyArray<AgentExecutionResponseDecorator>;
}
