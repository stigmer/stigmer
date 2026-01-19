package activities

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"go.temporal.io/sdk/activity"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UpdateExecutionStatusActivityImpl implements UpdateExecutionStatusActivity.
//
// Handles all persistence operations for agent execution status updates:
// - Load existing execution (single DB query)
// - Apply status updates (merge or replace based on field)
// - Update audit timestamps
// - Save to BadgerDB
//
// This is called by the agent-runner worker via polyglot Temporal workflow.
// Language-agnostic design: works regardless of which service implements the activity.
type UpdateExecutionStatusActivityImpl struct {
	store *badger.Store[*agentexecutionv1.AgentExecution]
}

// NewUpdateExecutionStatusActivityImpl creates a new UpdateExecutionStatusActivityImpl.
func NewUpdateExecutionStatusActivityImpl(store *badger.Store[*agentexecutionv1.AgentExecution]) *UpdateExecutionStatusActivityImpl {
	return &UpdateExecutionStatusActivityImpl{
		store: store,
	}
}

// UpdateExecutionStatus implements UpdateExecutionStatusActivity.UpdateExecutionStatus
func (a *UpdateExecutionStatusActivityImpl) UpdateExecutionStatus(ctx context.Context, executionID string, statusUpdates *agentexecutionv1.AgentExecutionStatus) error {
	activityInfo := activity.GetInfo(ctx)
	log.Debug().
		Str("activity_type", activityInfo.ActivityType.Name).
		Str("execution_id", executionID).
		Msg("Activity updating execution status")

	// Load existing execution (SINGLE DB QUERY)
	existing, err := a.store.Get(executionID)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Execution not found")
		return fmt.Errorf("execution not found: %w", err)
	}

	log.Debug().
		Str("execution_id", executionID).
		Int("messages", len(existing.GetStatus().GetMessages())).
		Int("tool_calls", len(existing.GetStatus().GetToolCalls())).
		Int("sub_agents", len(existing.GetStatus().GetSubAgentExecutions())).
		Int("todos", len(existing.GetStatus().GetTodos())).
		Msg("Loaded execution - current status")

	// Apply status updates from worker
	// Strategy: Full replacement for most fields (worker sends complete state)
	status := existing.Status
	if status == nil {
		status = &agentexecutionv1.AgentExecutionStatus{}
	}

	// Messages: Replace with latest from worker (complete list)
	if len(statusUpdates.GetMessages()) > 0 {
		log.Debug().
			Int("old_count", len(status.GetMessages())).
			Int("new_count", len(statusUpdates.GetMessages())).
			Msg("Replacing messages")
		status.Messages = statusUpdates.Messages
	}

	// Tool calls: Replace with latest from worker
	if len(statusUpdates.GetToolCalls()) > 0 {
		log.Debug().
			Int("old_count", len(status.GetToolCalls())).
			Int("new_count", len(statusUpdates.GetToolCalls())).
			Msg("Replacing tool_calls")
		status.ToolCalls = statusUpdates.ToolCalls
	}

	// Sub-agent executions: Replace with latest from worker
	if len(statusUpdates.GetSubAgentExecutions()) > 0 {
		log.Debug().
			Int("old_count", len(status.GetSubAgentExecutions())).
			Int("new_count", len(statusUpdates.GetSubAgentExecutions())).
			Msg("Replacing sub_agent_executions")
		status.SubAgentExecutions = statusUpdates.SubAgentExecutions
	}

	// Todos: Replace with latest from worker
	if len(statusUpdates.GetTodos()) > 0 {
		log.Debug().
			Int("old_count", len(status.GetTodos())).
			Int("new_count", len(statusUpdates.GetTodos())).
			Msg("Replacing todos")
		status.Todos = statusUpdates.Todos
	}

	// Phase: Update if provided
	if statusUpdates.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		log.Debug().
			Str("old_phase", status.Phase.String()).
			Str("new_phase", statusUpdates.Phase.String()).
			Msg("Updating phase")
		status.Phase = statusUpdates.Phase
	}

	// Error: Update if provided
	if statusUpdates.GetError() != "" {
		log.Debug().
			Str("error", statusUpdates.GetError()).
			Msg("Setting error")
		status.Error = statusUpdates.Error
	}

	// Started/Completed timestamps: Update if provided
	if statusUpdates.GetStartedAt() != "" {
		status.StartedAt = statusUpdates.StartedAt
	}
	if statusUpdates.GetCompletedAt() != "" {
		status.CompletedAt = statusUpdates.CompletedAt
	}

	// Update audit timestamp (status was modified)
	if status.Audit == nil {
		status.Audit = &apiresource.ApiResourceStatusAudit{}
	}
	if status.Audit.StatusAudit == nil {
		status.Audit.StatusAudit = &apiresource.ApiResourceAudit{}
	}
	status.Audit.StatusAudit.UpdatedAt = timestamppb.New(time.Now())
	status.Audit.StatusAudit.Event = apiresource.ApiResourceEventType_updated.String()

	existing.Status = status

	log.Debug().
		Str("execution_id", executionID).
		Int("messages", len(existing.GetStatus().GetMessages())).
		Int("tool_calls", len(existing.GetStatus().GetToolCalls())).
		Int("sub_agents", len(existing.GetStatus().GetSubAgentExecutions())).
		Int("todos", len(existing.GetStatus().GetTodos())).
		Str("phase", existing.GetStatus().GetPhase().String()).
		Msg("Built updated execution - new status")

	// Persist to BadgerDB
	if err := a.store.Put(executionID, existing); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to save execution")
		return fmt.Errorf("failed to save execution: %w", err)
	}

	log.Info().
		Str("execution_id", executionID).
		Int("messages", len(existing.GetStatus().GetMessages())).
		Int("tool_calls", len(existing.GetStatus().GetToolCalls())).
		Int("sub_agents", len(existing.GetStatus().GetSubAgentExecutions())).
		Int("todos", len(existing.GetStatus().GetTodos())).
		Str("phase", existing.GetStatus().GetPhase().String()).
		Msg("✅ Activity completed - Updated execution status")

	return nil
}
