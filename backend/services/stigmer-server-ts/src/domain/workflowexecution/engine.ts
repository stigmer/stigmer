/**
 * The workflow-execution engine seam — the ONE place this controller
 * touches Temporal-shaped behavior before sub-project #21 lands the
 * workflow-execution orchestrator on #18's shared worker infrastructure.
 *
 * Go models engine availability as two separately-injected nilable fields
 * on the controller (workflowCreator for create/sendSignal/taskApproval/
 * recover-start, temporalClient for the lifecycle signal/cancel/terminate
 * steps), re-injected by TemporalManager on every reconnect. The TS
 * guidelines forbid nullable modeling of optional infrastructure, so
 * availability is an explicit two-variant state instead (the shape the
 * sibling agentexecution domain ratified); #21's TemporalManager flips the
 * provider between the variants exactly where Go calls
 * SetWorkflowCreator/SetTemporalClient.
 *
 * Until #21, the composition root wires ENGINE_DISCONNECTED permanently —
 * byte-identical behavior to the Go server running without Temporal, with
 * each call site's own pinned posture (constants.ts): create refuses
 * Unavailable at the gate; the four lifecycle signal steps and recover's
 * terminate-existing refuse FailedPrecondition "Temporal is not
 * available"; sendSignal's send step refuses FailedPrecondition "workflow
 * creator is not available"; submitWorkflowTaskApproval refuses
 * Unavailable "workflow creator not configured for task '%s'"; recover's
 * fresh-start refuses FailedPrecondition with the creator-specific copy.
 *
 * The connected variant's surface carries exactly the operations THIS
 * controller consumes. Workflow IDs are built by the DOMAIN (Go builds
 * them in the controller steps — they are ported byte-pinned constants,
 * see constants.ts); dispatch-queue resolution (Go
 * wftemporal.ResolveWorkflowTaskQueue over spec.execution_target) is
 * temporal-slice code and lands inside #21's implementations, the same
 * absorption the agentexecution seam ratified.
 */
import type { JsonValue } from "@bufbuild/protobuf";
import type { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";

import { unavailableError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";

import { ENGINE_UNAVAILABLE_MESSAGE } from "./constants.js";

/**
 * The slim workflow-start input (Go wfactivities.
 * InvokeWorkflowExecutionWorkflowInput): only orchestration coordinates —
 * the slim-input doctrine keeps secrets out of Temporal history (they were
 * already consumed into the ExecutionContext). executionTarget feeds
 * #21's dispatch resolution ("global" → stigmer_runner, "execution" →
 * wfexec:{id}); the cloud-only CallbackToken/InvokerIdentityAccountID
 * fields have no OSS producer and are not modeled.
 */
export interface StartWorkflowExecutionInput {
  readonly executionId: string;
  readonly workflowInstanceId: string;
  readonly workflowId: string;
  readonly orgId: string;
  readonly recoveryMode: boolean;
  /** spec.execution_target — consumed by dispatch resolution, not Temporal. */
  readonly executionTarget: ExecutionTarget;
}

/**
 * The engine operations this controller consumes once Temporal is wired.
 * Implemented by #21; empty by design until then — see the module header.
 */
export interface ConnectedWorkflowExecutionEngine {
  /**
   * Starts the orchestrator workflow (Go workflowCreator.Create after
   * ResolveWorkflowTaskQueue). Used by create's StartWorkflow step and
   * recover's StartFreshWorkflow step.
   */
  startInvokeWorkflow(input: StartWorkflowExecutionInput): Promise<void>;

  /**
   * SignalWithStart against the orchestrator (Go
   * workflowCreator.SignalWithStart) — race-proof for PENDING executions
   * whose orchestrator has not started yet. Used by sendSignal and
   * submitWorkflowTaskApproval, always on the relaySignal channel.
   */
  signalWithStart(
    input: StartWorkflowExecutionInput,
    signalName: string,
    payload: JsonValue,
  ): Promise<void>;

  /**
   * Raw signal to a workflow ID (Go temporalClient.SignalWorkflow with
   * empty run ID = latest run). Used by the pause/resume lifecycle steps
   * against the orchestrator ID. Throws EngineWorkflowNotFoundError when
   * the workflow no longer exists — the steps treat that as
   * warn-and-proceed (the local state update still applies).
   */
  signalWorkflow(
    workflowId: string,
    signalName: string,
    payload: JsonValue | undefined,
  ): Promise<void>;

  /**
   * Cancels a workflow by ID (Go temporalClient.CancelWorkflow, empty run
   * ID). EngineWorkflowNotFoundError → warn-and-proceed.
   */
  cancelWorkflow(workflowId: string): Promise<void>;

  /**
   * Terminates a workflow by ID (Go temporalClient.TerminateWorkflow,
   * empty run ID). EngineWorkflowNotFoundError → warn-and-proceed (the
   * recover path treats NOT_FOUND on either tree member as success).
   */
  terminateWorkflow(workflowId: string, reason: string): Promise<void>;
}

/**
 * The engine's "workflow not found" sentinel (Go *serviceerror.NotFound
 * from the Temporal client). #21's implementation maps Temporal's
 * not-found onto it; tests construct it directly.
 */
export class EngineWorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`workflow not found: ${workflowId}`);
    this.name = "EngineWorkflowNotFoundError";
  }
}

/** Engine availability as an explicit modeled state (guidelines §4). */
export type WorkflowExecutionEngineState =
  | {
      readonly connected: true;
      readonly engine: ConnectedWorkflowExecutionEngine;
    }
  | { readonly connected: false };

/**
 * The permanent pre-#21 state: no Temporal behind this server. A frozen
 * singleton so identity comparisons in tests stay meaningful.
 */
export const ENGINE_DISCONNECTED: WorkflowExecutionEngineState =
  Object.freeze({ connected: false });

/**
 * A provider rather than a value: #21's TemporalManager re-injects on
 * every reconnect (Go's SetWorkflowCreator/SetTemporalClient), so
 * consumers must observe the CURRENT state at request time, never a
 * boot-time snapshot.
 */
export type WorkflowExecutionEngineStateProvider =
  () => WorkflowExecutionEngineState;

/**
 * EnsureEngineAvailable — create.go ensureEngineAvailableStep: rejects the
 * create fast — before any persistence or side effect — when the engine is
 * not connected. Pinned position: step 4, after ValidateWorkflowOrInstance
 * (a malformed request still answers InvalidArgument first) and before
 * CreateDefaultInstanceIfNeeded (a down engine orphans nothing — no
 * default instance, no ExecutionContext, no execution record). Go's unit
 * test pins the precedence: engine-unavailable beats workflow lookup.
 */
export function newEnsureEngineAvailableStep(
  engineState: WorkflowExecutionEngineStateProvider,
): PipelineStep<typeof WorkflowExecutionSchema> {
  return {
    name: "EnsureEngineAvailable",
    execute(_ctx: RequestContext<typeof WorkflowExecutionSchema>): void {
      if (!engineState().connected) {
        throw unavailableError(ENGINE_UNAVAILABLE_MESSAGE);
      }
    },
  };
}
