/**
 * The execution-engine seam — the ONE place the agentexecution controller
 * touches Temporal-shaped behavior before sub-project #18 lands the real
 * worker infrastructure.
 *
 * Go models engine availability as two separately-injected nilable fields
 * on the controller (workflowCreator for create/signal/recover,
 * temporalClient for the lifecycle RPCs), re-injected by TemporalManager
 * on every reconnect. The TS guidelines forbid nullable modeling of
 * optional infrastructure, so availability is an explicit two-variant
 * state instead; #18's TemporalManager will flip the provider between the
 * variants on connect/disconnect, exactly where Go calls
 * SetWorkflowCreator/SetTemporalClient.
 *
 * Until #18, the composition root wires ENGINE_DISCONNECTED permanently —
 * byte-identical behavior to the Go server running without Temporal:
 * create refuses Unavailable at the gate (create.go
 * ensureEngineAvailableStep), lifecycle RPCs refuse FailedPrecondition,
 * and submitApproval records the decision but skips the resolved-gate
 * signal with a WARN (submit_approval.go signalWorkflowStep).
 *
 * The connected variant's surface carries exactly the operations THIS
 * controller consumes (the seam Go defines through
 * workflowCreator/temporalClient method calls); #18 owns the
 * implementations. Operations the controller does not consume are not
 * pre-declared — #18's worker internals are its own plan's business.
 */
import type { RequestContext } from "../../pipeline/request-context.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { unavailableError } from "../../pipeline/errors.js";
import type { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import { ENGINE_UNAVAILABLE_MESSAGE } from "./constants.js";

/**
 * The engine operations the controller consumes once Temporal is wired.
 * Populated by #18 (sp.agentexecution-orchestration); empty by design
 * until then — see the module header.
 */
export interface ConnectedExecutionEngine {
  /**
   * Sends the approvalGateResolved signal to the execution's running
   * workflow (Go InvokeAgentExecutionWorkflowCreator.
   * SignalApprovalGateResolved). Throws EngineWorkflowNotFoundError when
   * the backing workflow no longer runs — SubmitApproval's signal step
   * then reconciles the stale execution to FAILED.
   */
  signalApprovalGateResolved(executionId: string): Promise<void>;

  /**
   * Starts the invoke-agent-execution workflow (Go's dispatch resolution
   * — ResolveActivityTaskQueue over the session + config — plus
   * workflowCreator.Create, both temporal-slice code that lands with
   * #18). Throws EngineDispatchError for dispatch-resolution failures
   * (the create step maps them to FailedPrecondition, exactly Go's
   * boundary); any other throw marks the execution FAILED.
   */
  startInvokeWorkflow(input: StartInvokeWorkflowInput): Promise<void>;

  /**
   * The lifecycle client operations (Go temporalClient.SignalWorkflow /
   * CancelWorkflow / TerminateWorkflow against the byte-pinned workflow
   * id). Each throws EngineWorkflowNotFoundError when the workflow no
   * longer exists — the lifecycle steps treat that as
   * warn-and-proceed (the local state update still applies).
   */
  signalPause(executionId: string, reason: string): Promise<void>;
  signalResume(executionId: string): Promise<void>;
  cancelWorkflow(executionId: string): Promise<void>;
  terminateWorkflow(executionId: string, reason: string): Promise<void>;
}

/**
 * The slim workflow-start input (Go
 * workflows.InvokeAgentExecutionWorkflowInput plus the dispatch
 * coordinates the engine resolves): only orchestration coordinates —
 * secrets (runtime_env) were already consumed into the ExecutionContext.
 */
export interface StartInvokeWorkflowInput {
  readonly executionId: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly callbackToken: Uint8Array;
  readonly autoApproveAll: boolean;
  readonly parentWorkflowId: string;
  /**
   * The spec's activity_task_queue override; "" lets the engine
   * re-resolve routing from the session (the recover path always passes
   * "" — see StartFreshWorkflowStep's rationale).
   */
  readonly activityTaskQueueOverride: string;
}

/**
 * Dispatch-resolution failure sentinel: the create/recover steps map it
 * to FailedPrecondition (Go's ResolveActivityTaskQueue error boundary).
 */
export class EngineDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineDispatchError";
  }
}

/**
 * The engine's "workflow not found" sentinel (Go
 * agentexecutiontemporal.ErrWorkflowNotFound). #18's implementation maps
 * Temporal's not-found onto it; tests construct it directly.
 */
export class EngineWorkflowNotFoundError extends Error {
  constructor(executionId: string) {
    super(`workflow not found for execution ${executionId}`);
    this.name = "EngineWorkflowNotFoundError";
  }
}

/** Engine availability as an explicit modeled state (guidelines §4). */
export type ExecutionEngineState =
  | { readonly connected: true; readonly engine: ConnectedExecutionEngine }
  | { readonly connected: false };

/**
 * The permanent pre-#18 state: no Temporal behind this server. A frozen
 * singleton so identity comparisons in tests stay meaningful.
 */
export const ENGINE_DISCONNECTED: ExecutionEngineState = Object.freeze({
  connected: false,
});

/**
 * A provider rather than a value: #18's TemporalManager re-injects on
 * every reconnect (Go's SetWorkflowCreator), so consumers must observe
 * the CURRENT state at request time, never a boot-time snapshot.
 */
export type ExecutionEngineStateProvider = () => ExecutionEngineState;

/**
 * EnsureEngineAvailable — create.go ensureEngineAvailableStep: rejects the
 * create fast — before any persistence or side effect — when the engine is
 * not connected. Placed after input validation but before the first
 * side-effecting step, so a malformed request still gets InvalidArgument
 * first and a down engine orphans nothing (no default instance, no
 * auto-created session, no ExecutionContext, no execution record).
 */
export function newEnsureEngineAvailableStep(
  engineState: ExecutionEngineStateProvider,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "EnsureEngineAvailable",
    execute(_ctx: RequestContext<typeof AgentExecutionSchema>): void {
      if (!engineState().connected) {
        throw unavailableError(ENGINE_UNAVAILABLE_MESSAGE);
      }
    },
  };
}
