package temporal

// Constants for agent execution Temporal workflow types and task queues.
const (
	// AgentExecutionInvoke is the workflow type for executing agents (Graphton).
	// Workflow ID format: stigmer/agent-execution/invoke/{execution-id}
	AgentExecutionInvoke = "stigmer/agent-execution/invoke"

	// AgentExecutionTaskQueue is the task queue for agent execution activities (ExecuteGraphton, EnsureThread).
	// Handles both workflows and Python activities on the same queue.
	AgentExecutionTaskQueue = "execution"

	// SignalSubmitApproval is the signal name for submitting HITL approval decisions.
	// This signal is sent to a running workflow when a user approves/skips/rejects a tool call.
	// The workflow receives this signal and unblocks its Workflow.await() to resume execution.
	SignalSubmitApproval = "submitApproval"

	// SignalApprovalGateResolved is sent when the approval gate for a HITL cycle
	// has fully resolved: either all pending tool calls have decisions, or a REJECT
	// was submitted (which triggers immediate resume — Python auto-skips remaining
	// tool calls). The workflow waits for exactly one of these per approval cycle.
	SignalApprovalGateResolved = "approvalGateResolved"

	// SignalPause is sent by the Pause RPC handler to gracefully pause a running execution.
	// The workflow cancels the activity, waits for it to save a LangGraph checkpoint,
	// then waits for a SignalResume before re-invoking.
	SignalPause = "pause"

	// SignalResume is sent by the Resume RPC handler to continue a paused execution.
	// The workflow re-invokes the Python activity, which loads from the LangGraph checkpoint.
	SignalResume = "resume"
)
