package workflows

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
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
		ID:                 workflowID,
		TaskQueue:          c.stigmerQueue,
		WorkflowRunTimeout: 30 * time.Minute, // Max 30 minutes per workflow execution
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

// SignalWithStart sends a signal to a workflow, starting it first if needed.
// This provides race-proof signal delivery for LISTEN tasks.
//
// Uses Temporal's SignalWithStart API which atomically handles both cases:
// - Workflow exists → sends signal immediately
// - Workflow not started yet → starts workflow, then sends signal
//
// This solves the race condition where a signal might arrive before the Temporal
// workflow is fully started. Without SignalWithStart, SignalWorkflow would fail
// with "WorkflowNotFound" if called too early.
func (c *InvokeWorkflowExecutionWorkflowCreator) SignalWithStart(
	ctx context.Context,
	execution *workflowexecutionv1.WorkflowExecution,
	signalName string,
	signalPayload interface{},
) error {
	executionID := execution.GetMetadata().GetId()

	// Workflow ID format: stigmer/workflow-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", InvokeWorkflowExecutionWorkflowName, executionID)

	options := client.StartWorkflowOptions{
		ID:                 workflowID,
		TaskQueue:          c.stigmerQueue,
		WorkflowRunTimeout: 30 * time.Minute,
		Memo: map[string]interface{}{
			"activityTaskQueue": c.runnerQueue,
		},
	}

	// SignalWithStart: atomically start workflow if needed, then send signal.
	// This ensures signal delivery even in race conditions where the signal
	// arrives before the workflow is fully started.
	_, err := c.workflowClient.SignalWithStartWorkflow(
		ctx,
		workflowID,
		signalName,
		signalPayload,
		options,
		InvokeWorkflowExecutionWorkflowName,
		execution,
	)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Str("execution_id", executionID).
			Str("signal_name", signalName).
			Msg("Failed to SignalWithStart workflow")
		return fmt.Errorf("failed to signal workflow: %w", err)
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("execution_id", executionID).
		Str("signal_name", signalName).
		Str("stigmer_queue", c.stigmerQueue).
		Msg("SignalWithStart completed successfully")

	return nil
}
