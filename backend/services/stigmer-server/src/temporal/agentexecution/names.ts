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
// Runner-owned (the TS unified runner registers them; this server only
// CALLS them — registering them here would break queue-based routing) are
// declared once, in `@stigmer/temporal-codecs/activity-names`, which the
// runner reads too, so the name the workflow schedules is the name the
// runner polls for. Not re-exported here: this module stays free of
// package imports for the test trees that read it by source path.

// Server-owned (registered by this worker):

/**
 * Registered once, invoked in BOTH modes: as a regular activity on the
 * stigmer queue from the failure/cancellation paths (dodging a Go-SDK
 * replay bug with local-activity markers after remote-activity failures —
 * the history SHAPE is preserved as contract), and as a local activity from
 * persistFinalStatus/persistInterruptedStatus.
 */
export const UPDATE_EXECUTION_STATUS_ACTIVITY_NAME = "UpdateExecutionStatus";

/**
 * The close of the previous turn's file review, run first in every
 * message turn's workflow: the previous turn's still-undecided edits are
 * kept now that a later message was sent (domain/run/filereview/autokeep.ts
 * keepOutdatedSets). Byte-pinned.
 */
export const CLOSE_FILE_REVIEW_ACTIVITY_NAME = "CloseFileReview";

/**
 * The count of a turn's open gates, read from its session's log
 * (store/session-events.ts `openGates`), which the workflow's HITL wait
 * reads. Byte-pinned.
 */
export const COUNT_OPEN_GATES_ACTIVITY_NAME = "CountOpenGates";

/**
 * The start of the turn a session's queued messages wait for
 * (domain/run/queued-turn.ts), run as a run's workflow ends, however it
 * ends: the durable start of messages sent while the turn worked.
 * Byte-pinned.
 */
export const START_QUEUED_TURN_ACTIVITY_NAME = "StartQueuedTurn";
