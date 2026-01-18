package temporal

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"

	workflowv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1/serverless"
)

// ServerlessWorkflowValidator is a client for executing serverless workflow validation via Temporal.
//
// This client calls the ValidateWorkflowWorkflow (Go workflow) which orchestrates
// Go activities in workflow-runner. It blocks until validation completes.
//
// Polyglot Configuration:
// - stigmer: Go workflows on workflow_validation_stigmer (stigmer-server)
// - runner: Go activities on workflow_validation_runner (workflow-runner)
// - Activity queue passed via memo for workflow to use when calling activities
//
// Flow:
// 1. Create unique workflow ID
// 2. Start ValidateWorkflowWorkflow on Go workflow queue
// 3. Workflow calls ValidateWorkflow activity (Go) on runner queue
// 4. Block until validation completes (expected: <200ms)
// 5. Return ServerlessWorkflowValidation result
//
// The validation activity returns one of three states:
// - VALID: Workflow structure is valid
// - INVALID: User error (bad structure, missing fields, etc.)
// - FAILED: System error (converter crashed, activity timeout, etc.)
//
// Performance:
// - Expected latency: 50-200ms
// - Timeout: 30 seconds (generous)
// - Non-blocking: Uses Temporal's async execution
//
// Error Handling:
// - Workflow timeout → Returns FAILED state
// - Temporal connection error → Returns error
// - Activity failures → Captured in validation result
type ServerlessWorkflowValidator struct {
	client client.Client
	config *Config
}

const workflowTimeout = 30 * time.Second

// NewServerlessWorkflowValidator creates a new ServerlessWorkflowValidator.
func NewServerlessWorkflowValidator(temporalClient client.Client, config *Config) *ServerlessWorkflowValidator {
	return &ServerlessWorkflowValidator{
		client: temporalClient,
		config: config,
	}
}

// Validate validates a workflow spec synchronously using Temporal workflow.
//
// This method blocks until validation completes. Expected time: 50-200ms.
//
// Returns validation result with YAML, state, errors, and warnings
// Returns error if Temporal execution fails
func (v *ServerlessWorkflowValidator) Validate(ctx context.Context, spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error) {
	if spec == nil {
		return nil, fmt.Errorf("WorkflowSpec cannot be nil")
	}

	// Generate unique workflow ID
	workflowID := generateWorkflowID()

	// Configure workflow options with activity task queue in memo
	// This allows the workflow to route activity calls to the Go worker (workflow-runner)
	memo := map[string]interface{}{
		"activityTaskQueue": v.config.RunnerQueue,
	}

	options := client.StartWorkflowOptions{
		ID:                       workflowID,
		TaskQueue:                v.config.StigmerQueue, // Go workflows run here
		WorkflowExecutionTimeout: workflowTimeout,
		Memo:                     memo, // Pass runner queue to workflow
	}

	// Start workflow and wait for result (synchronous)
	// This blocks until the workflow completes
	workflowRun, err := v.client.ExecuteWorkflow(ctx, options, WorkflowValidationWorkflowType, spec)
	if err != nil {
		return nil, fmt.Errorf("failed to start validation workflow: %w", err)
	}

	// Wait for workflow completion and get result
	var result serverlessv1.ServerlessWorkflowValidation
	err = workflowRun.Get(ctx, &result)
	if err != nil {
		return nil, fmt.Errorf("failed to execute validation workflow: %w", err)
	}

	return &result, nil
}

// generateWorkflowID generates a unique workflow ID for validation workflow.
// Format: stigmer/workflow-validation/{uuid}
func generateWorkflowID() string {
	return fmt.Sprintf("stigmer/workflow-validation/%s", uuid.New().String())
}

// CreateDataConverter creates a data converter for Temporal that supports protobufs.
// This is needed to serialize WorkflowSpec and ServerlessWorkflowValidation messages.
func CreateDataConverter() converter.DataConverter {
	return converter.GetDefaultDataConverter()
}
