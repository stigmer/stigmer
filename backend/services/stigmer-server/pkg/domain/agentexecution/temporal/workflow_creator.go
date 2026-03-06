package temporal

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

// InvokeAgentExecutionWorkflowCreator creates and starts Temporal workflows for agent execution invocation.
// Called by AgentExecutionCreateHandler after persisting execution to SQLite.
//
// Polyglot Configuration:
// - stigmer: Go workflows on agent_execution_stigmer (stigmer-server)
// - runner: Python activities on agent_execution_runner (agent-runner)
// - Activity queue passed via memo for workflow to use when calling activities
type InvokeAgentExecutionWorkflowCreator struct {
	workflowClient client.Client
	config         *Config
}

// NewInvokeAgentExecutionWorkflowCreator creates a new InvokeAgentExecutionWorkflowCreator.
func NewInvokeAgentExecutionWorkflowCreator(workflowClient client.Client, config *Config) *InvokeAgentExecutionWorkflowCreator {
	return &InvokeAgentExecutionWorkflowCreator{
		workflowClient: workflowClient,
		config:         config,
	}
}

// Create creates and starts a workflow for the given execution input.
//
// The input is a slim struct containing only the orchestration coordinates the
// workflow needs (execution ID, session ID, agent ID, callback token). Secrets
// and large payloads (runtime_env, message, attachments) are excluded from the
// Temporal workflow history.
func (c *InvokeAgentExecutionWorkflowCreator) Create(input *workflows.InvokeAgentExecutionWorkflowInput) error {
	executionID := input.ExecutionID

	// Workflow ID format: stigmer/agent-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	// NOTE: No WorkflowRunTimeout is set intentionally. This workflow supports
	// human-in-the-loop (HITL) approval flows where the workflow blocks waiting
	// for a submitApproval signal. Humans may take minutes, hours, or days to
	// respond -- any finite timeout would contradict the durable execution promise.
	// Activity-level timeouts (StartToCloseTimeout, HeartbeatTimeout) already
	// protect against stuck activities; the workflow itself is just an orchestrator.
	options := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: c.config.StigmerQueue,
		Memo: map[string]interface{}{
			"activityTaskQueue": c.config.RunnerQueue,
		},
	}

	// Start workflow asynchronously with the slim input
	_, err := c.workflowClient.ExecuteWorkflow(
		context.Background(),
		options,
		workflows.InvokeAgentExecutionWorkflowName,
		input,
	)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Str("execution_id", executionID).
			Msg("Failed to start workflow")
		return fmt.Errorf("failed to start workflow: %w", err)
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("execution_id", executionID).
		Str("stigmer_queue", c.config.StigmerQueue).
		Str("runner_queue", c.config.RunnerQueue).
		Msg("Started InvokeAgentExecutionWorkflow (runner activities on runner queue)")

	return nil
}

// SignalApproval sends a submitApproval signal to a running agent execution workflow.
//
// This is called by AgentExecutionSubmitApprovalHandler when a user submits
// an approval decision for a tool call. The workflow receives this signal
// and unblocks its Workflow.await() to resume execution with the decision.
//
// Parameters:
//   - executionID: The agent execution ID (used to construct workflow ID)
//   - input: The approval input containing tool_call_id, action, and comment
//
// Returns:
//   - ErrWorkflowNotFound if the workflow is not running
//   - Other errors for transient Temporal failures
//
// Thread Safety: This method is safe for concurrent use.
func (c *InvokeAgentExecutionWorkflowCreator) SignalApproval(executionID string, input *agentexecutionv1.SubmitApprovalInput) error {
	// Workflow ID format: stigmer/agent-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	log.Info().
		Str("workflow_id", workflowID).
		Str("execution_id", executionID).
		Str("tool_call_id", input.GetToolCallId()).
		Str("action", input.GetAction().String()).
		Msg("Sending submitApproval signal to workflow")

	// Send signal to workflow
	err := c.workflowClient.SignalWorkflow(
		context.Background(),
		workflowID,
		"", // Run ID - empty means latest run
		SignalSubmitApproval,
		input,
	)

	if err != nil {
		// Check for workflow not found error
		var notFoundErr *serviceerror.NotFound
		if errors.As(err, &notFoundErr) {
			log.Warn().
				Str("workflow_id", workflowID).
				Str("execution_id", executionID).
				Msg("Workflow not found - may have already completed")
			return fmt.Errorf("workflow not found for execution %s: %w", executionID, ErrWorkflowNotFound)
		}

		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Str("execution_id", executionID).
			Msg("Failed to signal workflow")
		return fmt.Errorf("failed to signal workflow: %w", err)
	}

	log.Info().
		Str("workflow_id", workflowID).
		Str("execution_id", executionID).
		Msg("Successfully sent submitApproval signal to workflow")

	return nil
}

// ErrWorkflowNotFound is returned when the workflow is not running.
// This typically means the execution has already completed or failed.
var ErrWorkflowNotFound = errors.New("workflow not found")
