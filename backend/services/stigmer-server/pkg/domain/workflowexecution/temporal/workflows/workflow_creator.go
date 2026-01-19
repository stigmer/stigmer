package workflows

import (
	"context"
	"fmt"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/rs/zerolog/log"
	"go.temporal.io/sdk/client"
)

// InvokeWorkflowExecutionWorkflowCreator creates and starts Temporal workflows for workflow execution invocation.
// Called by WorkflowExecutionController after persisting execution to BadgerDB.
//
// Polyglot Configuration:
// - stigmer: Go workflows on workflow_execution_stigmer (stigmer-server)
// - runner: Go activities on workflow_execution_runner (workflow-runner)
// - Activity queue passed via memo for workflow to use when calling activities
type InvokeWorkflowExecutionWorkflowCreator struct {
	workflowClient client.Client
	stigmerQueue   string
	runnerQueue    string
}

// NewInvokeWorkflowExecutionWorkflowCreator creates a new workflow creator.
func NewInvokeWorkflowExecutionWorkflowCreator(
	workflowClient client.Client,
	stigmerQueue string,
	runnerQueue string,
) *InvokeWorkflowExecutionWorkflowCreator {
	return &InvokeWorkflowExecutionWorkflowCreator{
		workflowClient: workflowClient,
		stigmerQueue:   stigmerQueue,
		runnerQueue:    runnerQueue,
	}
}

// Create starts a new workflow execution workflow.
func (c *InvokeWorkflowExecutionWorkflowCreator) Create(ctx context.Context, execution *workflowexecutionv1.WorkflowExecution) error {
	executionID := execution.GetMetadata().GetId()

	// Workflow ID format: stigmer/workflow-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", InvokeWorkflowExecutionWorkflowName, executionID)

	options := client.StartWorkflowOptions{
		ID:                    workflowID,
		TaskQueue:             c.stigmerQueue,
		WorkflowRunTimeout:    30 * time.Minute, // Max 30 minutes per workflow execution
		Memo: map[string]interface{}{
			"activityTaskQueue": c.runnerQueue, // Pass runner queue to workflow
		},
	}

	// Start workflow asynchronously
	_, err := c.workflowClient.ExecuteWorkflow(ctx, options, InvokeWorkflowExecutionWorkflowName, execution)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Str("execution_id", executionID).
			Msg("Failed to start InvokeWorkflowExecutionWorkflow")
		return fmt.Errorf("failed to start workflow: %w", err)
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("execution_id", executionID).
		Str("stigmer_queue", c.stigmerQueue).
		Str("runner_queue", c.runnerQueue).
		Msg("Started InvokeWorkflowExecutionWorkflow")

	return nil
}
