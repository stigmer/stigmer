package activities

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	apiresourcev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UpdateWorkflowExecutionStatusActivityImpl implements UpdateWorkflowExecutionStatusActivity.
//
// Handles all persistence operations for workflow execution status updates:
// - Load existing execution (single DB query)
// - Apply status updates (merge or replace based on field)
// - Update audit timestamps
// - Save to database
// - Broadcast to StreamBroker (for real-time updates to subscribers)
//
// This is called by the workflow-runner worker via polyglot Temporal workflow.
// Language-agnostic design: works regardless of which service implements the activity.
type UpdateWorkflowExecutionStatusActivityImpl struct {
	store        store.Store
	streamBroker StreamBroker
}

// StreamBroker interface for broadcasting execution updates
type StreamBroker interface {
	Broadcast(execution *workflowexecutionv1.WorkflowExecution)
}

// NewUpdateWorkflowExecutionStatusActivityImpl creates a new activity implementation.
func NewUpdateWorkflowExecutionStatusActivityImpl(store store.Store, streamBroker StreamBroker) *UpdateWorkflowExecutionStatusActivityImpl {
	return &UpdateWorkflowExecutionStatusActivityImpl{
		store:        store,
		streamBroker: streamBroker,
	}
}

// UpdateExecutionStatus implements UpdateWorkflowExecutionStatusActivity.UpdateExecutionStatus
func (a *UpdateWorkflowExecutionStatusActivityImpl) UpdateExecutionStatus(
	ctx context.Context,
	executionID string,
	statusUpdates *workflowexecutionv1.WorkflowExecutionStatus,
) error {
	log.Debug().
		Str("execution_id", executionID).
		Msg("Activity updating workflow execution status")

	// Load existing execution (SINGLE DB QUERY)
	existing := &workflowexecutionv1.WorkflowExecution{}
	if err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_workflow_execution, executionID, existing); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Workflow execution not found")
		return fmt.Errorf("workflow execution not found: %w", err)
	}

	log.Debug().
		Str("execution_id", executionID).
		Int("current_tasks", len(existing.GetStatus().GetTasks())).
		Str("current_phase", existing.GetStatus().GetPhase().String()).
		Msg("Loaded workflow execution")

	// Build updated execution with merged status
	updated := *existing
	if updated.Status == nil {
		updated.Status = &workflowexecutionv1.WorkflowExecutionStatus{}
	}

	// Apply status updates from worker
	// Strategy: Full replacement for most fields (worker sends complete state)

	// Tasks: Replace with latest from worker (complete list)
	if len(statusUpdates.GetTasks()) > 0 {
		log.Debug().
			Int("old_count", len(updated.Status.Tasks)).
			Int("new_count", len(statusUpdates.Tasks)).
			Msg("Replacing tasks")
		updated.Status.Tasks = statusUpdates.Tasks
	}

	// Phase: Update if provided
	if statusUpdates.Phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		log.Debug().
			Str("old_phase", updated.Status.Phase.String()).
			Str("new_phase", statusUpdates.Phase.String()).
			Msg("Updating phase")
		updated.Status.Phase = statusUpdates.Phase
	}

	// Error: Update if provided
	if statusUpdates.Error != "" {
		log.Debug().
			Str("error", statusUpdates.Error).
			Msg("Setting error")
		updated.Status.Error = statusUpdates.Error
	}

	// Started/Completed timestamps: Update if provided
	if statusUpdates.StartedAt != "" {
		updated.Status.StartedAt = statusUpdates.StartedAt
	}
	if statusUpdates.CompletedAt != "" {
		updated.Status.CompletedAt = statusUpdates.CompletedAt
	}

	// Update audit timestamp (status was modified)
	if updated.Status.Audit == nil {
		updated.Status.Audit = &apiresourcev1.ApiResourceAudit{}
	}
	if updated.Status.Audit.StatusAudit == nil {
		updated.Status.Audit.StatusAudit = &apiresourcev1.ApiResourceAuditInfo{}
	}
	updated.Status.Audit.StatusAudit.UpdatedAt = timestamppb.Now()
	updated.Status.Audit.StatusAudit.Event = apiresourcev1.ApiResourceEventType_updated.String()

	log.Debug().
		Str("execution_id", executionID).
		Int("tasks", len(updated.Status.Tasks)).
		Str("phase", updated.Status.Phase.String()).
		Msg("Built updated workflow execution")

	// Persist to database
	if err := a.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_workflow_execution, executionID, &updated); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to save workflow execution")
		return fmt.Errorf("failed to save workflow execution: %w", err)
	}

	log.Info().
		Str("execution_id", executionID).
		Int("tasks", len(updated.Status.Tasks)).
		Str("phase", updated.Status.Phase.String()).
		Msg("✅ Activity completed - Updated workflow execution status")

	// Broadcast to active subscribers (ADR 011: real-time streaming)
	// This ensures that errors from workflow failures are immediately visible to users
	if a.streamBroker != nil {
		a.streamBroker.Broadcast(&updated)
		log.Debug().
			Str("execution_id", executionID).
			Msg("Broadcasted status update to subscribers")
	}

	return nil
}
