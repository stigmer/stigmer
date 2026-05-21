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
	// Harness is the session's execution harness as a proto enum numeric value.
	// 0=HARNESS_UNSPECIFIED (treated as NATIVE), 1=HARNESS_NATIVE, 2=HARNESS_CURSOR.
	// Determines which activity type the workflow dispatches (ExecuteGraphton vs ExecuteCursor).
	Harness int32 `json:"harness,omitempty"`
	// ExecutionTarget is the resolved execution target as a proto enum numeric value.
	// 0=UNSPECIFIED, 1=LOCAL, 2=CLOUD.
	// Cloud deployments use this to trigger sandbox provisioning before agent activities.
	// The OSS workflow ignores this field — sandbox provisioning is cloud-only.
	ExecutionTarget int32 `json:"execution_target,omitempty"`
}
