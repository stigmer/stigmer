package temporal

// Signal names for the agent execution Temporal workflow. The workflow TYPE
// name lives beside its implementation (workflows.InvokeAgentExecutionWorkflowName,
// "stigmer/agent-execution/invoke"); queue names live on Config (config.go).
//
// Every string here is a WIRE IDENTIFIER: in-flight workflows reference them
// by value, so they must stay byte-identical across releases.
const (
	// SignalApprovalGateResolved is sent when the approval gate for a HITL cycle
	// has fully resolved: either all pending tool calls have decisions, or a REJECT
	// was submitted (which triggers immediate resume — the runner auto-skips
	// remaining tool calls). The workflow waits for exactly one of these per
	// approval cycle.
	SignalApprovalGateResolved = "approvalGateResolved"

	// SignalPause is sent by the Pause RPC handler to gracefully pause a running execution.
	// The workflow cancels the activity, waits for it to save a LangGraph checkpoint,
	// then waits for a SignalResume before re-invoking.
	SignalPause = "pause"

	// SignalResume is sent by the Resume RPC handler to continue a paused execution.
	// The workflow re-invokes the runner activity, which loads from the LangGraph
	// checkpoint.
	SignalResume = "resume"
)
