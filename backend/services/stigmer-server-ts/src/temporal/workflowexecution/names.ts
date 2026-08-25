/**
 * Workflow-execution Temporal wire identifiers — ports the constants of
 * pkg/domain/workflowexecution/temporal (workflow_types.go,
 * workflows/invoke_workflow.go, workflows/workflow_creator.go,
 * activities/update_status.go, dispatch.go).
 *
 * Every value here is a byte-pinned cross-edition wire constant (D2 §4).
 * The orchestrator workflow NAME, its ID format, the child workflow ID,
 * and the pause/resume/relaySignal channel names are canonically owned by
 * the DOMAIN's constants module (src/domain/workflowexecution/
 * constants.ts — #20 shipped them for the lifecycle steps) and re-exported
 * here so the temporal slice has one import surface and the program has
 * one definition.
 *
 * This module is imported by BOTH the workflow bundle and host code, so it
 * must stay free of node built-ins and framework imports (the Temporal
 * workflow sandbox bundler hard-fails on node imports — sub-project
 * 20260824.03 workflow-bundle import discipline; the domain constants
 * module it re-exports from is import-free).
 */
export {
  INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME,
  orchestratorWorkflowId,
  childWorkflowId,
  PAUSE_SIGNAL_NAME,
  RESUME_SIGNAL_NAME,
  RELAY_SIGNAL_CHANNEL_NAME,
} from "../../domain/workflowexecution/constants.js";

/**
 * The TS unified runner's child workflow type
 * (invoke_workflow_impl.go executeChildWorkflow; registered by the runner
 * in backend/services/runner/src/workflows/index.ts). This server never
 * registers it — starting it as a child on the memo-resolved runner queue
 * is the whole orchestration.
 */
export const CHILD_WORKFLOW_TYPE = "stigmer/workflow/execute-from-execution";

/**
 * The ONLY memo key this domain writes (workflow_creator.go); the
 * workflow reads it back to place the child. Go also falls back to the
 * legacy "activityTaskQueue" key for pre-migration in-flight histories —
 * NOT ported: no Go-era history can replay on this server (OD-6
 * start-clean), so the legacy read would be dead code.
 */
export const MEMO_RUNNER_TASK_QUEUE = "runnerTaskQueue";

/**
 * Fallback when the memo is somehow absent ("should never happen" — Go
 * getRunnerTaskQueue) and the dispatch default (config.go RunnerQueue).
 */
export const DEFAULT_RUNNER_TASK_QUEUE = "stigmer_runner";

/**
 * The status-persist activity, registered by THIS worker and invoked in
 * both modes: as a LOCAL activity from the pause/resume signal handlers
 * and as a REGULAR activity from the failure/cancellation paths (the same
 * local/regular split as agentexecution — remote on terminal paths dodges
 * the Go-SDK RECORD_MARKER replay bug; the history shape is contract).
 *
 * The name is Go's UpdateWorkflowExecutionStatusActivityName constant.
 * NOTE (sub-project DD-002): Go's production worker registers this
 * activity WITHOUT an explicit name, deriving "UpdateExecutionStatus"
 * from the method — so Go's own orchestrator persists never resolve the
 * activity and fail silently behind their best-effort call sites. This
 * server registers AND invokes under the one constant name, making the
 * lane work (the #18 DD-001 broken-Go-lane precedent; Go issue filed).
 */
export const UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME =
  "UpdateWorkflowExecutionStatus";

/**
 * The prefix for per-execution task queue names (dispatch.go
 * WfExecQueuePrefix). Format: "wfexec:{workflow_execution_id}".
 */
export const WFEXEC_QUEUE_PREFIX = "wfexec:";

/**
 * Derives the canonical per-execution Temporal task queue name
 * (dispatch.go FormatWfExecTaskQueue).
 */
export function formatWfExecTaskQueue(executionId: string): string {
  return `${WFEXEC_QUEUE_PREFIX}${executionId}`;
}
