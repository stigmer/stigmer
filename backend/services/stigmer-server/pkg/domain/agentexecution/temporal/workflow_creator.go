package temporal

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
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

// Create creates and starts a workflow for the given execution input, routing
// Python activities to the queue resolved by dispatch.
//
// The input is a slim struct containing only the orchestration coordinates the
// workflow needs (execution ID, session ID, agent ID, callback token). Secrets
// and large payloads (runtime_env, message, attachments) are excluded from the
// Temporal workflow history.
//
// The dispatch result always contains a per-runner task queue — the caller
// (ResolveActivityTaskQueue) resolves this before invoking Create.
func (c *InvokeAgentExecutionWorkflowCreator) Create(input *workflows.InvokeAgentExecutionWorkflowInput, dispatch *DispatchResult) error {
	executionID := input.ExecutionID

	activityQueue := dispatch.TaskQueue

	// Workflow ID format: stigmer/agent-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	// NOTE: No WorkflowRunTimeout is set intentionally. This workflow supports
	// human-in-the-loop (HITL) approval flows where the workflow blocks waiting
	// for an approvalGateResolved signal. Humans may take minutes, hours, or days
	// to respond -- any finite timeout would contradict the durable execution promise.
	// Activity-level timeouts (StartToCloseTimeout, HeartbeatTimeout) already
	// protect against stuck activities; the workflow itself is just an orchestrator.
	options := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: c.config.StigmerQueue,
		Memo: map[string]interface{}{
			"activityTaskQueue": activityQueue,
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
		Str("activity_queue", activityQueue).
		Msg("Started InvokeAgentExecutionWorkflow")

	return nil
}

// SignalApprovalGateResolved sends an approvalGateResolved signal to a running
// agent execution workflow, indicating that the approval gate for the current
// HITL cycle has fully resolved.
//
// This is sent by SubmitApproval when either:
//   - All pending tool calls have received decisions (gate fully cleared)
//   - A REJECT action was submitted (immediate resume, Python auto-skips remaining)
//
// The workflow waits for exactly one of these signals per approval cycle.
func (c *InvokeAgentExecutionWorkflowCreator) SignalApprovalGateResolved(executionID string) error {
	workflowID := fmt.Sprintf("%s/%s", workflows.InvokeAgentExecutionWorkflowName, executionID)

	log.Info().
		Str("workflow_id", workflowID).
		Str("execution_id", executionID).
		Msg("Sending approvalGateResolved signal to workflow")

	err := c.workflowClient.SignalWorkflow(
		context.Background(),
		workflowID,
		"",
		SignalApprovalGateResolved,
		nil,
	)

	if err != nil {
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
		Msg("Successfully sent approvalGateResolved signal to workflow")

	return nil
}

// ErrWorkflowNotFound is returned when the workflow is not running.
// This typically means the execution has already completed or failed.
var ErrWorkflowNotFound = errors.New("workflow not found")
