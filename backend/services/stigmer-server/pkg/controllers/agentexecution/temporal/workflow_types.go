package temporal

// Constants for agent execution Temporal workflow types and task queues.
const (
	// AgentExecutionInvoke is the workflow type for executing agents (Graphton).
	// Workflow ID format: stigmer/agent-execution/invoke/{execution-id}
	AgentExecutionInvoke = "stigmer/agent-execution/invoke"

	// AgentExecutionTaskQueue is the task queue for agent execution activities (ExecuteGraphton, EnsureThread).
	// Handles both workflows and Python activities on the same queue.
	AgentExecutionTaskQueue = "execution"
)
