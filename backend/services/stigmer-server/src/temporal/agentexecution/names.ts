/**
 * Agent-execution Temporal wire identifiers — ports the constants of
 * pkg/domain/agentexecution/temporal (workflow_types.go,
 * workflows/invoke_workflow.go, activities/*.go).
 *
 * Every value here is a byte-pinned cross-edition wire constant:
 * the TS runner, the Go server, and the Java control plane all address
 * workflows, signals, activities, and memos by these exact strings.
 * Renaming one is a wire-protocol break, not a style fix.
 *
 * This module is imported by BOTH the workflow bundle and host code, so it
 * must stay free of node built-ins and framework imports (the Temporal
 * workflow sandbox bundler hard-fails on node imports).
 */

/** Go workflows.InvokeAgentExecutionWorkflowName. */
export const INVOKE_AGENT_EXECUTION_WORKFLOW_NAME =
  "stigmer/agent-execution/invoke";

/**
 * Workflow ID format: stigmer/agent-execution/invoke/{execution-id} —
 * rebuilt identically by the creator and every lifecycle step (Go
 * fmt.Sprintf in workflow_creator.go and lifecycle_steps.go).
 */
export function invokeWorkflowIdFor(executionId: string): string {
  return `${INVOKE_AGENT_EXECUTION_WORKFLOW_NAME}/${executionId}`;
}

/** Go temporal.SignalPause — pauses the running activity loop. */
export const SIGNAL_PAUSE = "pause";

/** Go temporal.SignalResume — resumes a paused execution. */
export const SIGNAL_RESUME = "resume";

/**
 * Go temporal.SignalApprovalGateResolved — sent by SubmitApproval when the
 * unified HITL gate fully clears (all tool calls decided, or a REJECT).
 */
export const SIGNAL_APPROVAL_GATE_RESOLVED = "approvalGateResolved";

/**
 * The ONLY memo key this domain writes (workflow_creator.go); the workflow
 * reads it back on every dispatch.
 */
export const MEMO_ACTIVITY_TASK_QUEUE = "activityTaskQueue";

/**
 * Fallback when the memo is somehow absent ("should never happen" — Go
 * getActivityTaskQueue) and the dispatch default (dispatch.go
 * DefaultActivityTaskQueue).
 */
export const DEFAULT_ACTIVITY_TASK_QUEUE = "stigmer_runner";

// ─── Activity names ─────────────────────────────────────────────────────
// Runner-owned (the TS unified runner registers these; this server only
// CALLS them — registering them here would break queue-based routing):

export const ENSURE_THREAD_ACTIVITY_NAME = "EnsureThread";
export const EXECUTE_DEEP_AGENT_ACTIVITY_NAME = "ExecuteDeepAgent";
export const EXECUTE_CURSOR_ACTIVITY_NAME = "ExecuteCursor";
export const GENERATE_SESSION_SUBJECT_ACTIVITY_NAME = "GenerateSessionSubject";

// Server-owned (registered by this worker):

/**
 * Registered once, invoked in BOTH modes: as a regular activity on the
 * stigmer queue from the failure/cancellation paths (dodging a Go-SDK
 * replay bug with local-activity markers after remote-activity failures —
 * the history SHAPE is preserved as contract), and as a local activity from
 * persistFinalStatus/persistInterruptedStatus.
 */
export const UPDATE_EXECUTION_STATUS_ACTIVITY_NAME = "UpdateExecutionStatus";

export const LOAD_AGENT_EXECUTION_ACTIVITY_NAME = "LoadAgentExecution";
export const READ_HARNESS_STATE_ID_ACTIVITY_NAME = "ReadHarnessStateId";
