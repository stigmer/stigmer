/**
 * WorkflowExecution byte-pinned wire copy and identifiers — every string a
 * client or the Temporal wire can observe from this domain, copied
 * character-for-character from the Go controller
 * (pkg/domain/workflowexecution/controller). Coexistence rule: the Go
 * server is the behavioral reference; do not "improve" copy here
 * (guidelines §2).
 */

/**
 * create's engine-gate refusal (create.go engineUnavailableMessage) —
 * deliberately identical across AgentExecution and WorkflowExecution so
 * both domains present one symmetric create-boundary contract. Pinned by
 * the Class A conformance engine-gate test.
 */
export const ENGINE_UNAVAILABLE_MESSAGE =
  "The execution engine is temporarily unavailable. Please try again shortly.";

/**
 * The lifecycle steps' engineless refusal (lifecycle_steps.go, five
 * sites: pause/resume/cancel/terminate signal steps and recover's
 * terminate-existing). FailedPrecondition, not Unavailable — the ratified
 * Go asymmetry between the create gate and the lifecycle surface.
 */
export const TEMPORAL_UNAVAILABLE_MESSAGE = "Temporal is not available";

/**
 * Recover's fresh-start refusal (lifecycle_steps.go
 * StartFreshWorkflowStep) — the creator-specific variant of the message
 * above, also FailedPrecondition.
 */
export const TEMPORAL_UNAVAILABLE_CREATOR_MESSAGE =
  "Temporal is not available (workflow creator not set)";

/**
 * sendSignal's engineless refusal (send_signal.go SendSignalToWorkflowStep)
 * — FailedPrecondition with its own copy, distinct from both messages
 * above.
 */
export const WORKFLOW_CREATOR_UNAVAILABLE_MESSAGE =
  "workflow creator is not available";

/**
 * The Go orchestrator workflow name (temporal/workflows
 * InvokeWorkflowExecutionWorkflowName) — a cross-edition Temporal wire
 * constant; the orchestrator's workflow ID is `{name}/{executionId}`.
 */
export const INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME =
  "stigmer/workflow-execution/invoke";

/** The orchestrator workflow ID for an execution (lifecycle_steps.go). */
export function orchestratorWorkflowId(executionId: string): string {
  return `${INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME}/${executionId}`;
}

/**
 * The TS runner child workflow ID (lifecycle_steps.go
 * TerminateExistingWorkflowStep: "workflow-exec-" + executionID). The
 * child has ParentClosePolicy=REQUEST_CANCEL, so recover terminates it
 * explicitly for a hard ID-reuse guarantee.
 */
export function childWorkflowId(executionId: string): string {
  return `workflow-exec-${executionId}`;
}

/**
 * Signal channel names on the orchestrator (temporal/workflows). pause and
 * resume are handled by Go's single selector goroutine; every other signal
 * rides the generic relaySignal envelope (June DD-013).
 */
export const PAUSE_SIGNAL_NAME = "pause";
export const RESUME_SIGNAL_NAME = "resume";
export const RELAY_SIGNAL_CHANNEL_NAME = "relaySignal";

/**
 * submitWorkflowTaskApproval's signal-name prefix
 * (submit_workflow_task_approval.go humanInputSignalPrefix): the runner
 * listens on `human_input_{taskName}`.
 */
export const HUMAN_INPUT_SIGNAL_PREFIX = "human_input_";

/**
 * getEventLog pagination bounds (get_event_log.go): requests default to
 * 100 events and are capped at 500 — the pinned CW-7 pagination contract.
 */
export const DEFAULT_EVENT_PAGE_SIZE = 100;
export const MAX_EVENT_PAGE_SIZE = 500;

/**
 * listPendingApprovals pagination bounds (list_pending_approvals.go):
 * default 20, cap 100.
 */
export const DEFAULT_PENDING_APPROVALS_PAGE_SIZE = 20;
export const MAX_PENDING_APPROVALS_PAGE_SIZE = 100;

/**
 * subscribeEvents' live-tail poll interval (subscribe_events.go
 * eventPollInterval = 500ms): the latency floor Go chose for event
 * delivery after replay; faster polling buys little (the runner batches
 * updates through updateStatus) and multiplies read load per subscriber.
 */
export const EVENT_POLL_INTERVAL_MS = 500;
