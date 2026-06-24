package activities

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
	"go.temporal.io/sdk/activity"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UpdateExecutionStatusActivityImpl implements UpdateExecutionStatusActivity.
//
// Handles all persistence operations for agent execution status updates:
// - Load existing execution (single DB query)
// - Apply status updates (merge or replace based on field)
// - Update audit timestamps
// - Save to database
// - Broadcast to StreamBroker (for real-time updates to subscribers)
//
// This is called by the agent-runner worker via polyglot Temporal workflow.
// Language-agnostic design: works regardless of which service implements the activity.
type UpdateExecutionStatusActivityImpl struct {
	store        store.Store
	streamBroker StreamBroker
}

// StreamBroker interface for broadcasting execution updates
type StreamBroker interface {
	Broadcast(execution *agentexecutionv1.AgentExecution)
}

// NewUpdateExecutionStatusActivityImpl creates a new UpdateExecutionStatusActivityImpl.
func NewUpdateExecutionStatusActivityImpl(store store.Store, streamBroker StreamBroker) *UpdateExecutionStatusActivityImpl {
	return &UpdateExecutionStatusActivityImpl{
		store:        store,
		streamBroker: streamBroker,
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
	existing := &agentexecutionv1.AgentExecution{}
	err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, existing)
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
		Int("sub_agents", len(existing.GetStatus().GetSubAgentExecutions())).
		Int("todos", len(existing.GetStatus().GetTodos())).
		Msg("Loaded execution - current status")

	// Apply status updates from worker
	// Strategy: Full replacement for most fields (worker sends complete state)
	status := existing.Status
	if status == nil {
		status = &agentexecutionv1.AgentExecutionStatus{}
	}

	// Snapshot existing messages/sub-agents before replacement so we can
	// preserve SubmitApproval-owned fields that Python doesn't know about.
	existingMessages := status.GetMessages()
	existingSubAgents := status.GetSubAgentExecutions()

	// Messages: Replace with latest from worker (complete list)
	if len(statusUpdates.GetMessages()) > 0 {
		log.Debug().
			Int("old_count", len(status.GetMessages())).
			Int("new_count", len(statusUpdates.GetMessages())).
			Msg("Replacing messages")
		status.Messages = statusUpdates.Messages
	}

	// Sub-agent executions: Replace with latest from worker
	if len(statusUpdates.GetSubAgentExecutions()) > 0 {
		log.Debug().
			Int("old_count", len(status.GetSubAgentExecutions())).
			Int("new_count", len(statusUpdates.GetSubAgentExecutions())).
			Msg("Replacing sub_agent_executions")
		status.SubAgentExecutions = statusUpdates.SubAgentExecutions
	}

	// Preserve approval fields (approval_action, approval_decided_at, approved_by)
	// that were atomically recorded by SubmitApproval. Python always sends
	// UNSPECIFIED for these fields, so without this step the wholesale message
	// replacement above would erase user-submitted approval decisions.
	approval.PreserveApprovalFields(
		status.GetMessages(),
		status.GetSubAgentExecutions(),
		existingMessages,
		existingSubAgents,
	)

	// Todos: Replace with latest from worker
	if len(statusUpdates.GetTodos()) > 0 {
		log.Debug().
			Int("old_count", len(status.GetTodos())).
			Int("new_count", len(statusUpdates.GetTodos())).
			Msg("Replacing todos")
		status.Todos = statusUpdates.Todos
	}

	// Phase: Update if provided — applied BEFORE the approval projection so the
	// phase-aware seam (ProjectPendingApprovals) sees the FINAL phase. A status
	// that drives the execution terminal (notably the workflow's FAILED-at-gate
	// update, which carries no messages and so preserves the gated tool call)
	// must collapse pending_approvals to empty in the SAME write; otherwise a
	// gated call left in the transcript would be re-projected as pending on a dead
	// execution. This ordering is what makes terminal-execution gate-exits correct
	// without a per-call retraction event.
	if statusUpdates.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		log.Debug().
			Str("old_phase", status.Phase.String()).
			Str("new_phase", statusUpdates.Phase.String()).
			Msg("Updating phase")
		status.Phase = statusUpdates.Phase
	}

	// Author REQUESTED events for any tool call now in the approval gate
	// (seeding the persisted stream the first time it is touched). This server-only
	// field is preserved in place across the merge above; decisions are authored
	// separately by SubmitApproval. RETRACTED events for in-flight orphans are
	// authored here too (skipped for the terminal phase set just above).
	approval.EnsureApprovalRequests(status, executionID)

	// Compute pending_approvals from tool call state in messages, via the single
	// projection seam (a pure read that also runs the event-stream parity check).
	status.PendingApprovals = approval.ProjectPendingApprovals(
		status.GetPhase(),
		status.GetMessages(),
		status.GetSubAgentExecutions(),
		status.GetApprovalEventStream(),
	)

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

	// Merge context_info (replace with latest from request)
	if statusUpdates.ContextInfo != nil {
		status.ContextInfo = statusUpdates.ContextInfo
	}

	// Merge resolved_context (replace with latest from request)
	if statusUpdates.ResolvedContext != nil {
		status.ResolvedContext = statusUpdates.ResolvedContext
	}

	// Update audit timestamp (status was modified)
	if status.Audit == nil {
		status.Audit = &apiresource.ApiResourceAudit{}
	}
	if status.Audit.StatusAudit == nil {
		status.Audit.StatusAudit = &apiresource.ApiResourceAuditInfo{}
	}
	status.Audit.StatusAudit.UpdatedAt = timestamppb.New(time.Now())
	status.Audit.StatusAudit.Event = apiresource.ApiResourceEventType_updated.String()

	existing.Status = status

	log.Debug().
		Str("execution_id", executionID).
		Int("messages", len(existing.GetStatus().GetMessages())).
		Int("sub_agents", len(existing.GetStatus().GetSubAgentExecutions())).
		Int("todos", len(existing.GetStatus().GetTodos())).
		Int("pending_approvals", len(existing.GetStatus().GetPendingApprovals())).
		Str("phase", existing.GetStatus().GetPhase().String()).
		Bool("has_context_info", existing.GetStatus().GetContextInfo() != nil).
		Bool("has_resolved_context", existing.GetStatus().GetResolvedContext() != nil).
		Msg("Built updated execution - new status")

	// Persist to database
	if err := a.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, existing); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to save execution")
		return fmt.Errorf("failed to save execution: %w", err)
	}

	log.Info().
		Str("execution_id", executionID).
		Int("messages", len(existing.GetStatus().GetMessages())).
		Int("sub_agents", len(existing.GetStatus().GetSubAgentExecutions())).
		Int("todos", len(existing.GetStatus().GetTodos())).
		Str("phase", existing.GetStatus().GetPhase().String()).
		Msg("Activity completed - Updated execution status")

	// Broadcast to active subscribers (ADR 011: real-time streaming)
	// This ensures that errors from workflow failures are immediately visible to users
	if a.streamBroker != nil {
		a.streamBroker.Broadcast(existing)
		log.Debug().
			Str("execution_id", executionID).
			Msg("Broadcasted status update to subscribers")
	}

	return nil
}
