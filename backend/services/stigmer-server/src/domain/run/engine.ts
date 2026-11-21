/**
 * The execution-engine seam — the ONE place the agentexecution controller
 * touches Temporal-shaped behavior.
 *
 * The guidelines forbid nullable modeling of optional infrastructure, so
 * engine availability is an explicit two-variant state; the
 * TemporalManager-backed provider (temporal/agentexecution/engine-client.ts)
 * flips between the variants on connect/disconnect.
 *
 * While disconnected (until the first successful connect), the server
 * runs without Temporal: create refuses Unavailable at the gate
 * (EnsureEngineAvailable), lifecycle RPCs refuse FailedPrecondition,
 * and an answer to a waiting tool use is recorded but skips the
 * resolved-gate signal with a WARN (domain/session/hitl/answer.ts).
 *
 * The connected variant's surface carries exactly the operations the
 * domain consumes; the temporal implementation owns them. Operations
 * nothing consumes are not pre-declared. One of them is a read, not a
 * command: whether a run's workflow is still alive (workflowLiveness),
 * which the stalled-run checker asks so a working run whose workflow is
 * gone is ended rather than left working forever (stalled-runs.ts,
 * stigmer#3120).
 */
import type { RequestContext } from "../../pipeline/request-context.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { unavailableError } from "../../pipeline/errors.js";
import type { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import type { SandboxCaller } from "../../sandbox/session-sandbox.js";
import { ENGINE_UNAVAILABLE_MESSAGE } from "./constants.js";

/**
 * The engine operations the controller consumes once Temporal is wired
 * (implemented by temporal/agentexecution/engine-client.ts).
 */
export interface ConnectedExecutionEngine {
  /**
   * Sends the approvalGateResolved signal to the execution's running
   * workflow. Throws EngineWorkflowNotFoundError when
   * the backing workflow no longer runs — the answer core's signal step
   * then reconciles the stale execution to FAILED.
   */
  signalApprovalGateResolved(executionId: string): Promise<void>;

  /**
   * Starts the invoke-agent-execution workflow (dispatch resolution — the
   * task queue over the session + config — plus the start, both
   * temporal-slice code). Throws EngineDispatchError for
   * dispatch-resolution failures (the create step maps them to
   * FailedPrecondition); any other throw marks the execution FAILED.
   */
  startInvokeWorkflow(input: StartInvokeWorkflowInput): Promise<void>;

  /**
   * The lifecycle client operations (signal, cancel and terminate
   * against the byte-pinned workflow id). Each throws EngineWorkflowNotFoundError when the workflow no
   * longer exists — the lifecycle steps treat that as
   * warn-and-proceed (the local state update still applies).
   */
  signalPause(executionId: string, reason: string): Promise<void>;
  signalResume(executionId: string): Promise<void>;
  cancelWorkflow(executionId: string): Promise<void>;
  terminateWorkflow(executionId: string, reason: string): Promise<void>;

  /**
   * Whether the execution's workflow is still alive: `open` while it runs
   * or an operator has paused it, `closed` once it ended in any way, and
   * `not_found` when the engine holds no such workflow (closed past its
   * retention, or its history lost). A status the engine cannot name
   * throws, like any other fault, so the caller asks again later and never
   * ends a run on an answer it could not read. The stalled-run checker
   * (stalled-runs.ts) ends a working run whose workflow is not open.
   */
  workflowLiveness(executionId: string): Promise<WorkflowLiveness>;
}

/** What workflowLiveness answers (ConnectedExecutionEngine). */
export type WorkflowLiveness = "open" | "closed" | "not_found";

/**
 * The slim workflow-start input (the workflow input plus the dispatch
 * coordinates the engine resolves): only orchestration coordinates — the
 * runner fetches the run's values from their vaults when its work starts.
 */
export interface StartInvokeWorkflowInput {
  readonly executionId: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly autoApproveAll: boolean;
  /**
   * The run is a reconcile turn (`spec.reconcile_file_review`): its
   * workflow titles no session and closes no earlier turn's review.
   */
  readonly reconcileFileReview?: boolean;
  /**
   * The caller whose request starts the run: the workflow's sandbox
   * ensure hands its class, and a routine's fire its routine, to the
   * driver (sandbox/session-sandbox.ts). Required,
   * so a start site that forgets it fails to compile.
   */
  readonly caller: SandboxCaller;
}

/**
 * Dispatch-resolution failure sentinel: the create/recover steps map it
 * to FailedPrecondition (the task-queue resolution boundary).
 */
export class EngineDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineDispatchError";
  }
}

/**
 * The engine's "workflow not found" sentinel. The engine client maps
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
 * The disconnected state: no Temporal behind this server. A frozen
 * singleton so identity comparisons in tests stay meaningful.
 */
export const ENGINE_DISCONNECTED: ExecutionEngineState = Object.freeze({
  connected: false,
});

/**
 * A provider rather than a value: the TemporalManager re-injects on
 * every reconnect, so consumers must observe
 * the CURRENT state at request time, never a boot-time snapshot.
 */
export type ExecutionEngineStateProvider = () => ExecutionEngineState;

/**
 * EnsureEngineAvailable — rejects the
 * create fast — before any persistence or side effect — when the engine is
 * not connected. Placed after input validation but before the first
 * side-effecting step, so a malformed request still gets InvalidArgument
 * first and a down engine orphans nothing (no auto-created session, no
 * execution record).
 */
export function newEnsureEngineAvailableStep(
  engineState: ExecutionEngineStateProvider,
): PipelineStep<typeof RunSchema> {
  return {
    name: "EnsureEngineAvailable",
    execute(_ctx: RequestContext<typeof RunSchema>): void {
      if (!engineState().connected) {
        throw unavailableError(ENGINE_UNAVAILABLE_MESSAGE);
      }
    },
  };
}
