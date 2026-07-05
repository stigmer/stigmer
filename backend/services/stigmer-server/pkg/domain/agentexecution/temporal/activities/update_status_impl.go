package activities

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/filereview"
	"go.temporal.io/sdk/activity"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UpdateExecutionStatusActivityImpl implements UpdateExecutionStatusActivity.
//
// Handles all persistence operations for agent execution status updates:
// - Atomically load + merge + persist in one read-modify-write (store.UpdateResource)
// - Apply status updates (merge or replace based on field)
// - Author approval REQUESTED/RETRACTED events and project pending_approvals
// - Update audit timestamps
// - Broadcast to StreamBroker (for real-time updates to subscribers)
//
// The load and save are a single atomic unit under the store's write lock — the
// same discipline the gRPC UpdateStatus path uses — so an approval event a
// concurrent SubmitApproval appends to the now-authoritative
// approval_event_stream can never be lost to a stale-read overwrite.
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

	// Atomic read-modify-write under the store's per-resource write lock: the
	// merge below runs on the freshly-loaded state and is persisted in the same
	// locked unit. This is what makes the append-only approval_event_stream safe
	// by construction — a decision a concurrent SubmitApproval appends in the gate
	// overlap window can no longer be clobbered by a stale-read whole-doc save.
	updated := &agentexecutionv1.AgentExecution{}
	err := a.store.UpdateResource(
		ctx,
		apiresourcekind.ApiResourceKind_agent_execution,
		executionID,
		updated,
		func() error {
			// Apply status updates from worker.
			// Strategy: Full replacement for most fields (worker sends complete state)
			if updated.Status == nil {
				updated.Status = &agentexecutionv1.AgentExecutionStatus{}
			}
			status := updated.Status

			log.Debug().
				Str("execution_id", executionID).
				Int("messages", len(status.GetMessages())).
				Int("sub_agents", len(status.GetSubAgentExecutions())).
				Int("todos", len(status.GetTodos())).
				Msg("Loaded execution - current status")

			// Snapshot existing messages/sub-agents before replacement so we can
			// preserve SubmitApproval-owned fields that Python doesn't know about.
			existingMessages := status.GetMessages()
			existingSubAgents := status.GetSubAgentExecutions()

			// Messages: Replace with latest from worker (complete list)
			if len(statusUpdates.GetMessages()) > 0 {
				log.Debug().
					Int("old_count", len(existingMessages)).
					Int("new_count", len(statusUpdates.GetMessages())).
					Msg("Replacing messages")
				status.Messages = statusUpdates.Messages
			}

			// Sub-agent executions: Replace with latest from worker
			if len(statusUpdates.GetSubAgentExecutions()) > 0 {
				log.Debug().
					Int("old_count", len(existingSubAgents)).
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
			// authored here too (skipped for the terminal phase set just above). Running
			// inside the write lock on the freshly-loaded stream guarantees these appends
			// never clobber a concurrently-appended decision.
			approval.EnsureApprovalRequests(status, executionID)

			// Compute pending_approvals from the authored event stream, via the single
			// projection seam (returns the event-stream projection and runs the scan
			// parity cross-check).
			status.PendingApprovals = approval.ProjectPendingApprovals(
				status.GetPhase(),
				status.GetMessages(),
				status.GetSubAgentExecutions(),
				status.GetApprovalEventStream(),
			)

			// Fold the runner-authored capture/reconcile events (carried on the
			// status update) into the server-owned ledger: append-only, idempotent
			// by event_id, FILE_DECIDED dropped (server-authored by
			// SubmitFileDecision). Runs on the freshly-loaded stream under the write
			// lock so it can never clobber a concurrent decision.
			filereview.AppendRunnerEvents(status, executionID, statusUpdates)

			// Approved-command auto-keep (DD-28): a candidate whose provenance
			// verifies against the server-authored approval record is decided by
			// policy IN THE SAME WRITE that folded it, so the gate never arms for a
			// set the user already consented to via the command approval.
			filereview.AutoKeepApprovedCommandSets(status, executionID, updated.GetSpec().GetAutoApproveAll())

			// Recompute file_change_sets from the append-only file_review ledger via
			// its single projection seam. The ledger (server-owned, preserved in place
			// across this merge like approval_event_stream) is authored by the runner's
			// capture/reconcile activities (folded just above), the auto-keep policy,
			// and SubmitFileDecision; this projection is always derived, never merged,
			// so it cannot go stale.
			status.FileChangeSets = filereview.ProjectFileChangeSets(
				status.GetPhase(),
				status.GetFileReviewEventStream(),
			)

			// Mid-run live capture (DD-32): merge the runner-owned transient
			// progress snapshot (presence-guarded, like streaming_usage), then clear
			// it unless its change set is still CAPTURING — the setup_progress-style
			// defense-in-depth clear, run here so it sees the freshly-projected
			// file_change_sets.
			if statusUpdates.GetFileChangeProgress() != nil {
				status.FileChangeProgress = statusUpdates.GetFileChangeProgress()
			}
			status.FileChangeProgress = filereview.ReconcileFileChangeProgress(
				status.GetFileChangeSets(),
				status.GetFileChangeProgress(),
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

			log.Debug().
				Str("execution_id", executionID).
				Int("messages", len(status.GetMessages())).
				Int("sub_agents", len(status.GetSubAgentExecutions())).
				Int("todos", len(status.GetTodos())).
				Int("pending_approvals", len(status.GetPendingApprovals())).
				Str("phase", status.GetPhase().String()).
				Bool("has_context_info", status.GetContextInfo() != nil).
				Bool("has_resolved_context", status.GetResolvedContext() != nil).
				Msg("Built updated execution - new status")

			return nil
		},
	)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Error().
				Err(err).
				Str("execution_id", executionID).
				Msg("Execution not found")
			return fmt.Errorf("execution not found: %w", err)
		}
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to save execution")
		return fmt.Errorf("failed to save execution: %w", err)
	}

	log.Info().
		Str("execution_id", executionID).
		Int("messages", len(updated.GetStatus().GetMessages())).
		Int("sub_agents", len(updated.GetStatus().GetSubAgentExecutions())).
		Int("todos", len(updated.GetStatus().GetTodos())).
		Str("phase", updated.GetStatus().GetPhase().String()).
		Msg("Activity completed - Updated execution status")

	// Broadcast to active subscribers (ADR 011: real-time streaming)
	// This ensures that errors from workflow failures are immediately visible to users
	if a.streamBroker != nil {
		a.streamBroker.Broadcast(updated)
		log.Debug().
			Str("execution_id", executionID).
			Msg("Broadcasted status update to subscribers")
	}

	return nil
}
