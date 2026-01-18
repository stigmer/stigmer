package activities

import (
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ExecuteWorkflowActivity is the interface for executing Zigflow workflows.
//
// Implementation: Go (workflow-runner service)
// Task Queue: "workflow_execution_runner"
//
// Agent-Runner Pattern (Phases 1-3.5):
// - Receives WorkflowExecution proto (contains execution_id and metadata)
// - Queries Stigmer service via gRPC:
//   - GetWorkflowExecution by execution_id
//   - GetWorkflowInstance from execution.spec.workflow_instance_id
//   - GetWorkflow from instance.spec.workflow_id
// - Converts WorkflowSpec proto → YAML (Phase 2 converter)
// - Executes via Zigflow engine
// - Sends progressive status updates via gRPC callbacks
// - Returns final status to Temporal workflow
//
// This is implemented in Go at:
// backend/services/workflow-runner/worker/activities/execute_workflow_activity.go
type ExecuteWorkflowActivity interface {
	// ExecuteWorkflow executes a Zigflow workflow from WorkflowExecution proto.
	//
	// Flow:
	// 1. Query Stigmer service for complete workflow context
	// 2. Convert WorkflowSpec proto → YAML (using Phase 2 converter)
	// 3. Execute via Zigflow engine
	// 4. Send progressive status updates via gRPC
	// 5. Return final status
	//
	// execution: WorkflowExecution proto containing execution metadata
	// Returns: Final WorkflowExecutionStatus after execution completes
	ExecuteWorkflow(execution *workflowexecutionv1.WorkflowExecution) (*workflowexecutionv1.WorkflowExecutionStatus, error)
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
func (s *executeWorkflowActivityStub) ExecuteWorkflow(execution *workflowexecutionv1.WorkflowExecution) (*workflowexecutionv1.WorkflowExecutionStatus, error) {
	var result *workflowexecutionv1.WorkflowExecutionStatus
	err := workflow.ExecuteActivity(s.ctx, ExecuteWorkflowActivityName, execution).Get(s.ctx, &result)
	return result, err
}
