package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UpdateStatus updates workflow execution status during workflow execution.
//
// This RPC is called by the workflow-runner to send progressive status updates
// (phase transitions, task states, output, errors, etc.).
//
// This handler is optimized for frequent status updates and merges status fields
// with existing state without requiring the full execution resource.
//
// What Can Be Updated:
// - status.phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
// - status.tasks (update task statuses, outputs, errors)
// - status.output (set final workflow output when COMPLETED)
// - status.error (set error message when FAILED)
// - status.started_at (set when execution starts)
// - status.completed_at (set when execution finishes)
//
// What Cannot Be Updated:
// - spec.* (user inputs are immutable after creation)
// - metadata.id (resource ID is immutable)
// - status.audit.created_at (creation timestamp is immutable)
//
// Implementation Notes:
// - This is a DIRECT implementation (not using pipeline pattern)
// - Loads existing execution, merges status updates, persists
// - Updates status.audit.updated_at timestamp
// - Returns updated execution for confirmation
//
// Authorization:
// In Cloud, this RPC verifies caller is the workflow runner service (system identity).
// In OSS, we skip authorization checks (single-user local environment).
//
// Use Cases:
// 1. Task Started: Workflow runner updates status.tasks[i].status = IN_PROGRESS
// 2. Task Completed: Workflow runner updates status.tasks[i].status = COMPLETED, sets output
// 3. Task Failed: Workflow runner updates status.tasks[i].status = FAILED, sets error
// 4. Workflow Completed: Workflow runner updates status.phase = COMPLETED, sets output
// 5. Workflow Failed: Workflow runner updates status.phase = FAILED, sets error
// 6. Workflow Cancelled: Workflow runner updates status.phase = CANCELLED
func (c *WorkflowExecutionController) UpdateStatus(ctx context.Context, input *workflowexecutionv1.WorkflowExecutionUpdateStatusInput) (*workflowexecutionv1.WorkflowExecution, error) {
	executionID := input.GetExecutionId()
	statusUpdate := input.GetStatus()

	if executionID == "" {
		return nil, grpclib.InvalidArgumentError("execution_id is required")
	}

	if statusUpdate == nil {
		return nil, grpclib.InvalidArgumentError("status is required")
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", statusUpdate.GetPhase().String()).
		Int("tasks_count", len(statusUpdate.GetTasks())).
		Msg("Updating workflow execution status")

	// 1. Load existing execution
	existing := &workflowexecutionv1.WorkflowExecution{}
	if err := c.store.GetResource(ctx, "WorkflowExecution", executionID, existing); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to load workflow execution")
		return nil, grpclib.NotFoundError("WorkflowExecution", executionID)
	}

	// 2. Merge status fields
	if existing.Status == nil {
		existing.Status = &workflowexecutionv1.WorkflowExecutionStatus{}
	}

	// Merge phase
	if statusUpdate.Phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		existing.Status.Phase = statusUpdate.Phase
	}

	// Merge tasks (replace entire tasks array if provided)
	if statusUpdate.Tasks != nil {
		existing.Status.Tasks = statusUpdate.Tasks
	}

	// Merge output
	if statusUpdate.Output != nil {
		existing.Status.Output = statusUpdate.Output
	}

	// Merge error
	if statusUpdate.Error != "" {
		existing.Status.Error = statusUpdate.Error
	}

	// Merge timestamps
	if statusUpdate.StartedAt != "" {
		existing.Status.StartedAt = statusUpdate.StartedAt
	}

	if statusUpdate.CompletedAt != "" {
		existing.Status.CompletedAt = statusUpdate.CompletedAt
	}

	if statusUpdate.TemporalWorkflowId != "" {
		existing.Status.TemporalWorkflowId = statusUpdate.TemporalWorkflowId
	}

	// 3. Update audit timestamp
	if existing.Status.Audit == nil {
		existing.Status.Audit = &apiresource.ApiResourceAudit{}
	}
	if existing.Status.Audit.StatusAudit == nil {
		existing.Status.Audit.StatusAudit = &apiresource.ApiResourceAuditInfo{}
	}
	existing.Status.Audit.StatusAudit.UpdatedAt = timestamppb.Now()

	// 4. Persist updated execution
	if err := c.store.SaveResource(ctx, "WorkflowExecution", executionID, existing); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to persist workflow execution status update")
		return nil, grpclib.InternalError(err, "failed to update workflow execution status")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("phase", existing.Status.Phase.String()).
		Msg("Successfully updated workflow execution status")

	return existing, nil
}
