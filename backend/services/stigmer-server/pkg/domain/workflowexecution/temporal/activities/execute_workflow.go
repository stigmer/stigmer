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
// The same input type is passed to the ExecuteWorkflow activity. The Go activity
// hydrates the full context (WorkflowInstance, Workflow, ExecutionContext) via
// gRPC using the IDs carried here.
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

// ExecuteWorkflowActivity is the interface for executing Zigflow workflows.
//
// Implementation: Go (workflow-runner service)
// Task Queue: "workflow_execution_runner"
//
// Slim-Payload Pattern:
//   - Receives slim orchestration coordinates (execution_id, workflow_instance_id,
//     workflow_id, org_id, invoker_identity_account_id)
//   - Queries Stigmer service via gRPC to hydrate full context:
//   - GetWorkflowInstance from input.WorkflowInstanceID
//   - GetWorkflow from instance.spec.workflow_id
//   - GetExecutionContext by execution_id (merged environment)
//
// - Converts WorkflowSpec proto to YAML (Phase 2 converter)
// - Executes via Zigflow engine
// - Sends progressive status updates via gRPC callbacks
// - Returns final status to Temporal workflow
//
// This is implemented in Go at:
// backend/services/workflow-runner/worker/activities/execute_workflow_activity.go
type ExecuteWorkflowActivity interface {
	// ExecuteWorkflow executes a Zigflow workflow using slim orchestration coordinates.
	//
	// The activity hydrates the full context (WorkflowInstance, Workflow,
	// ExecutionContext) via gRPC using the IDs in the input.
	ExecuteWorkflow(input *InvokeWorkflowExecutionWorkflowInput) (*workflowexecutionv1.WorkflowExecutionStatus, error)
}

// ExecuteWorkflowActivityName is the activity name used for registration.
// This MUST match the activity name in the workflow-runner implementation.
const ExecuteWorkflowActivityName = "ExecuteWorkflow"

// NewExecuteWorkflowActivityStub creates an activity stub for executing workflows.
//
// ctx: Workflow context
// taskQueue: Task queue for routing to Go worker (from workflow memo)
func NewExecuteWorkflowActivityStub(ctx workflow.Context, taskQueue string) ExecuteWorkflowActivity {
	options := workflow.ActivityOptions{
		TaskQueue:           taskQueue,
		StartToCloseTimeout: 30 * time.Minute, // Longer timeout for workflows
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 1, // No retries for workflow execution
			InitialInterval: 10 * time.Second,
		},
	}

	activityCtx := workflow.WithActivityOptions(ctx, options)
	return &executeWorkflowActivityStub{ctx: activityCtx}
}

// executeWorkflowActivityStub is the client-side stub for ExecuteWorkflowActivity.
type executeWorkflowActivityStub struct {
	ctx workflow.Context
}

// ExecuteWorkflow implements ExecuteWorkflowActivity.ExecuteWorkflow
func (s *executeWorkflowActivityStub) ExecuteWorkflow(input *InvokeWorkflowExecutionWorkflowInput) (*workflowexecutionv1.WorkflowExecutionStatus, error) {
	var result *workflowexecutionv1.WorkflowExecutionStatus
	err := workflow.ExecuteActivity(s.ctx, ExecuteWorkflowActivityName, input).Get(s.ctx, &result)
	return result, err
}
