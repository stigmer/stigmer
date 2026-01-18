package workflows

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentexecution/temporal"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/client"
)

// InvokeAgentExecutionWorkflowCreator creates and starts Temporal workflows for agent execution invocation.
// Called by AgentExecutionCreateHandler after persisting execution to BadgerDB.
//
// Polyglot Configuration:
// - stigmer: Go workflows on agent_execution_stigmer (stigmer-server)
// - runner: Python activities on agent_execution_runner (agent-runner)
// - Activity queue passed via memo for workflow to use when calling activities
type InvokeAgentExecutionWorkflowCreator struct {
	workflowClient client.Client
	config         *temporal.Config
}

// NewInvokeAgentExecutionWorkflowCreator creates a new InvokeAgentExecutionWorkflowCreator.
func NewInvokeAgentExecutionWorkflowCreator(workflowClient client.Client, config *temporal.Config) *InvokeAgentExecutionWorkflowCreator {
	return &InvokeAgentExecutionWorkflowCreator{
		workflowClient: workflowClient,
		config:         config,
	}
}

// Create creates and starts a workflow for the given execution.
func (c *InvokeAgentExecutionWorkflowCreator) Create(execution *agentexecutionv1.AgentExecution) error {
	executionID := execution.GetMetadata().GetId()

	// Workflow ID format: stigmer/agent-execution/invoke/{execution-id}
	workflowID := fmt.Sprintf("%s/%s", InvokeAgentExecutionWorkflowName, executionID)

	// Build workflow options
	options := client.StartWorkflowOptions{
		ID:                  workflowID,
		TaskQueue:           c.config.StigmerQueue,
		WorkflowRunTimeout:  10 * time.Minute, // Max 10 minutes per execution
		Memo: map[string]interface{}{
			"activityTaskQueue": c.config.RunnerQueue, // Pass runner queue to workflow
		},
	}

	// Start workflow asynchronously
	_, err := c.workflowClient.ExecuteWorkflow(
		context.Background(), // Use background context for async start
		options,
		InvokeAgentExecutionWorkflowName,
		execution,
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
