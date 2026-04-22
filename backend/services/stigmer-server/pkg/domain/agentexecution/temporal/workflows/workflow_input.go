package workflows

// InvokeAgentExecutionWorkflowInput is the slim input for the agent execution
// Temporal workflow. It carries only the orchestration coordinates the workflow
// needs -- no secrets, no large payloads, no fields that are only relevant at
// creation time.
//
// This replaces the previous pattern of passing the full AgentExecution proto
// as the workflow input. The full proto contained runtime_env (which may hold
// secrets) and other fields the workflow never accessed. By using a slim input,
// secrets are kept out of Temporal's durable workflow history.
//
// Fields included for forward-compatibility with the cloud's approval and
// parent-notification features (AutoApproveAll, ParentWorkflowID) even if the
// OSS workflow does not use them yet.
type InvokeAgentExecutionWorkflowInput struct {
	ExecutionID              string `json:"execution_id"`
	SessionID                string `json:"session_id"`
	AgentID                  string `json:"agent_id"`
	CallbackToken            []byte `json:"callback_token,omitempty"`
	AutoApproveAll           bool   `json:"auto_approve_all,omitempty"`
	ParentWorkflowID         string `json:"parent_workflow_id,omitempty"`
	InvokerIdentityAccountID string `json:"invoker_identity_account_id,omitempty"`
	// RunnerID is the ID of the Runner resolved by dispatch, or empty
	// when using the global shared runner queue. The workflow records this on
	// AgentExecutionStatus.runner_id for observability.
	RunnerID string `json:"runner_id,omitempty"`
}
