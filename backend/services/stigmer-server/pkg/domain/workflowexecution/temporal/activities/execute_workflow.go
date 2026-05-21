package activities

import (
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// InvokeWorkflowExecutionWorkflowInput is the slim input for the workflow execution
// Temporal workflow. It carries only the orchestration coordinates the workflow
// needs -- no secrets, no large payloads, no fields that are only relevant at
// creation time.
//
// This replaces the previous pattern of passing the full WorkflowExecution proto
// as the workflow input. The full proto contained runtime_env (which may hold
// secrets) and other fields the workflow never accessed. By using a slim input,
// secrets are kept out of Temporal's durable workflow history.
//
// The same input type is passed to the TS child workflow
// ("stigmer/workflow/execute-from-execution"). The child workflow hydrates the
// full context (WorkflowInstance, Workflow, ExecutionContext) via gRPC using
// the IDs carried here.
//
// This type lives in the activities package (rather than workflows) to avoid an
// import cycle: workflows imports activities for stubs, so shared types must be
// in the lower-level package.
type InvokeWorkflowExecutionWorkflowInput struct {
	ExecutionID              string `json:"execution_id"`
	WorkflowInstanceID       string `json:"workflow_instance_id,omitempty"`
	WorkflowID               string `json:"workflow_id,omitempty"`
	OrgID                    string `json:"org_id,omitempty"`
	CallbackToken            []byte `json:"callback_token,omitempty"`
	InvokerIdentityAccountID string `json:"invoker_identity_account_id,omitempty"`
}

// Legacy activity stub retained for version 0 deterministic replay.
// The Go workflow-runner has been deleted; any new execution hitting this path
// will timeout on ScheduleToStart because no worker polls the old queue.

// ExecuteWorkflowActivity is the legacy interface for executing workflows via
// a Go activity. Retained for version 0 backward compatibility only.
type ExecuteWorkflowActivity interface {
	ExecuteWorkflow(input *InvokeWorkflowExecutionWorkflowInput) (*workflowexecutionv1.WorkflowExecutionStatus, error)
}

// ExecuteWorkflowActivityName is the legacy activity name.
const ExecuteWorkflowActivityName = "ExecuteWorkflow"

// NewExecuteWorkflowActivityStub creates a legacy activity stub.
// Retained for version 0 deterministic replay only.
func NewExecuteWorkflowActivityStub(ctx workflow.Context, taskQueue string) ExecuteWorkflowActivity {
	options := workflow.ActivityOptions{
		TaskQueue:           taskQueue,
		StartToCloseTimeout: 30 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 1,
			InitialInterval: 10 * time.Second,
		},
	}

	activityCtx := workflow.WithActivityOptions(ctx, options)
	return &executeWorkflowActivityStub{ctx: activityCtx}
}

type executeWorkflowActivityStub struct {
	ctx workflow.Context
}

func (s *executeWorkflowActivityStub) ExecuteWorkflow(input *InvokeWorkflowExecutionWorkflowInput) (*workflowexecutionv1.WorkflowExecutionStatus, error) {
	var result *workflowexecutionv1.WorkflowExecutionStatus
	err := workflow.ExecuteActivity(s.ctx, ExecuteWorkflowActivityName, input).Get(s.ctx, &result)
	return result, err
}
