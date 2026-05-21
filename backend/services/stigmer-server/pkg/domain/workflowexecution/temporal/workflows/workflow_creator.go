package workflows

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"go.temporal.io/sdk/client"
)

// InvokeWorkflowExecutionWorkflowCreator creates and starts Temporal workflows for workflow execution invocation.
// Called by WorkflowExecutionController after persisting execution to SQLite.
//
// Configuration:
// - stigmer: Go orchestrator workflows on workflow_execution_stigmer (stigmer-server)
// - runner: TS child workflows on stigmer_runner (unified runner)
// - Runner queue passed via memo for workflow to use when starting child workflows
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

// Create starts a new workflow execution workflow with slim input.
// Secrets (runtime_env) are excluded from Temporal history — they live in the ExecutionContext.
//
// The runnerQueue parameter specifies the TS unified runner queue for the child workflow.
// When empty, falls back to c.runnerQueue (the configured default, typically "stigmer_runner").
// Callers pass the resolved queue from ResolveWorkflowTaskQueue() to enable per-execution
// sandbox routing (wfexec:{id}) in cloud mode.
func (c *InvokeWorkflowExecutionWorkflowCreator) Create(ctx context.Context, input *activities.InvokeWorkflowExecutionWorkflowInput, runnerQueue string) error {
	executionID := input.ExecutionID

	effectiveRunnerQueue := c.runnerQueue
	if runnerQueue != "" {
		effectiveRunnerQueue = runnerQueue
	}

	// Workflow ID format: stigmer/workflow-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", InvokeWorkflowExecutionWorkflowName, executionID)

	options := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: c.stigmerQueue,
		Memo: map[string]interface{}{
			"runnerTaskQueue": effectiveRunnerQueue,
		},
	}

	// Start workflow asynchronously with slim input
	_, err := c.workflowClient.ExecuteWorkflow(ctx, options, InvokeWorkflowExecutionWorkflowName, input)
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
		Str("runner_queue", effectiveRunnerQueue).
		Msg("Started InvokeWorkflowExecutionWorkflow")

	return nil
}

// SignalWithStart sends a signal to a workflow, starting it first if needed.
// This provides race-proof signal delivery for LISTEN tasks.
//
// Uses Temporal's SignalWithStart API which atomically handles both cases:
// - Workflow exists -> sends signal immediately
// - Workflow not started yet -> starts workflow, then sends signal
//
// This solves the race condition where a signal might arrive before the Temporal
// workflow is fully started. Without SignalWithStart, SignalWorkflow would fail
// with "WorkflowNotFound" if called too early.
func (c *InvokeWorkflowExecutionWorkflowCreator) SignalWithStart(
	ctx context.Context,
	input *activities.InvokeWorkflowExecutionWorkflowInput,
	signalName string,
	signalPayload interface{},
	runnerQueue string,
) error {
	executionID := input.ExecutionID

	effectiveRunnerQueue := c.runnerQueue
	if runnerQueue != "" {
		effectiveRunnerQueue = runnerQueue
	}

	// Workflow ID format: stigmer/workflow-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", InvokeWorkflowExecutionWorkflowName, executionID)

	options := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: c.stigmerQueue,
		Memo: map[string]interface{}{
			"runnerTaskQueue": effectiveRunnerQueue,
		},
	}

	// SignalWithStart: atomically start workflow if needed, then send signal.
	// Slim input keeps secrets out of Temporal history.
	_, err := c.workflowClient.SignalWithStartWorkflow(
		ctx,
		workflowID,
		signalName,
		signalPayload,
		options,
		InvokeWorkflowExecutionWorkflowName,
		input,
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
