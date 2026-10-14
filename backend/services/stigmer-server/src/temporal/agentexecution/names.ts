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
 * Go temporal.SignalApprovalGateResolved — sent by the answer core
 * (domain/session/hitl/answer.ts) when the turn has no open ask left.
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

/**
 * The close of the previous turn's file review, run first in every
 * message turn's workflow: the previous turn's still-undecided edits are
 * kept now that a later message was sent (domain/run/filereview/autokeep.ts
 * keepOutdatedSets). Byte-pinned.
 */
export const CLOSE_FILE_REVIEW_ACTIVITY_NAME = "CloseFileReview";
export const READ_HARNESS_STATE_ID_ACTIVITY_NAME = "ReadHarnessStateId";

/**
 * The retired run-end delete of a run's stored copy of its values. A run
 * no longer stores one (its values are fetched from their vaults when its
 * work starts), so new runs never call it: the workflow skips the call
 * behind VALUES_FETCHED_PATCH_ID. A run started before that change has the
 * call in its history, and a replay must make it again, so the worker
 * still registers the name, with a body that does nothing (the upgrade's
 * migration deleted every stored copy). Byte-pinned.
 */
export const RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME = "DeleteExecutionContext";

/** The workflow patch that stops new runs calling the retired delete above. Byte-pinned. */
export const VALUES_FETCHED_PATCH_ID = "values-fetched-from-vaults";

/**
 * The workflow patch behind which a message turn calls CloseFileReview
 * first: a run started before the step has no such call in its history,
 * so a replay of it makes none. Byte-pinned.
 */
export const CLOSE_FILE_REVIEW_PATCH_ID = "close-file-review";

/**
 * The count of a turn's open gates, read from its session's log
 * (store/session-events.ts `openGates`): the workflow's HITL wait reads it
 * in place of the run's pending approvals. Byte-pinned.
 */
export const COUNT_OPEN_GATES_ACTIVITY_NAME = "CountOpenGates";

/**
 * The workflow patch behind which the HITL wait counts the turn's open
 * gates from the log (COUNT_OPEN_GATES_ACTIVITY_NAME): a run whose history
 * loaded the run for its pending approvals replays that load. Byte-pinned.
 */
export const OPEN_GATES_FROM_LOG_PATCH_ID = "open-gates-from-log";
