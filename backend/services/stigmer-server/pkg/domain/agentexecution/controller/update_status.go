package agentexecution

import (
	"context"
	"errors"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/filereview"
)

// UpdateStatus updates execution status during agent execution
//
// Used by agent-runner to send progressive status updates (messages, tool_calls, phase, etc.)
// This RPC is optimized for frequent status updates and merges status fields with existing state.
//
// Pipeline Steps:
// 1. ValidateInput - Validate execution_id and status are provided
// 2. MergeAndPersist - Atomically load, merge status updates, and persist
// 3. BroadcastToStreams - Push update to active Go channels (ADR 011)
//
// The merge+persist is a single atomic read-modify-write (store.UpdateResource)
// rather than a load step followed by a separate whole-resource save. This is the
// same discipline SubmitApproval uses, and it is load-bearing now that the
// append-only approval_event_stream is the source of truth for pending_approvals:
// a non-atomic load-then-save could drop an approval event a concurrent
// SubmitApproval appended in the window between the load and the save (a user
// approving one sub-agent's gated call while another sub-agent still streams).
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - PublishToRedis step (no Redis in OSS - uses in-memory Go channels instead per ADR 011)
// - Publish step (no event publishing in OSS)
func (c *AgentExecutionController) UpdateStatus(ctx context.Context, input *agentexecutionv1.AgentExecutionUpdateStatusInput) (*agentexecutionv1.UpdateStatusResponse, error) {
	// Create request context with input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build pipeline
	p := pipeline.NewPipeline[*agentexecutionv1.AgentExecutionUpdateStatusInput]("agentexecution-update-status").
		AddStep(newValidateUpdateStatusInputStep()).
		AddStep(newMergeAndPersistExecutionStep(c.store)).
		AddStep(newBroadcastToStreamsStep(c.streamBroker)).
		Build()

	// Execute pipeline
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return &agentexecutionv1.UpdateStatusResponse{
		Signal: agentexecutionv1.ExecutionControlSignal_EXECUTION_CONTROL_SIGNAL_UNSPECIFIED,
	}, nil
}

// ValidateUpdateStatusInputStep validates the input for UpdateStatus
type ValidateUpdateStatusInputStep struct{}

func newValidateUpdateStatusInputStep() *ValidateUpdateStatusInputStep {
	return &ValidateUpdateStatusInputStep{}
}

func (s *ValidateUpdateStatusInputStep) Name() string {
	return "ValidateUpdateStatusInput"
}

func (s *ValidateUpdateStatusInputStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionUpdateStatusInput]) error {
	input := ctx.Input()

	if input == nil {
		return grpclib.InvalidArgumentError("input is required")
	}

	if input.ExecutionId == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}

	if input.Status == nil {
		return grpclib.InvalidArgumentError("status is required")
	}

	log.Debug().
		Str("execution_id", input.ExecutionId).
		Msg("Validated UpdateStatus input")

	return nil
}

// nonTerminalTranscriptRegression reports whether replacing existing with incoming
// would drop committed transcript history for a non-terminal execution, plus a
// short reason for the rejection log. It enforces the append-only-at-identity
// invariant documented at the call site: a non-terminal transcript may grow and
// reconcile entries in place, but it may neither shrink nor drop a previously
// committed tool-call id. Terminal executions may be rewritten freely and so are
// never a regression here.
func nonTerminalTranscriptRegression(
	phase agentexecutionv1.ExecutionPhase,
	existing, incoming []*agentexecutionv1.AgentMessage,
) (reject bool, reason string) {
	if isTerminalPhase(phase) {
		return false, ""
	}
	if len(incoming) < len(existing) {
		return true, "would shrink the message transcript"
	}

	incomingToolCallIDs := make(map[string]struct{})
	for _, m := range incoming {
		for _, tc := range m.GetToolCalls() {
			if id := tc.GetId(); id != "" {
				incomingToolCallIDs[id] = struct{}{}
			}
		}
	}
	for _, m := range existing {
		for _, tc := range m.GetToolCalls() {
			id := tc.GetId()
			if id == "" {
				continue
			}
			if _, ok := incomingToolCallIDs[id]; !ok {
				return true, "would drop a previously-committed tool call"
			}
		}
	}
	return false, ""
}

// applyUpdateStatusMerge merges an incoming status update into execution in place,
// following the runner-owns-the-transcript merge rules. It is the body run inside
// the UpdateResource closure (and exercised directly by the guard tests), so
// execution carries the freshly-loaded, locked state — the merge, the approval
// event authoring, and the pending_approvals projection all see the same snapshot
// that will be persisted.
//
// It mirrors the Java BuildNewStateWithStatusStep merge strategy: most fields are
// replaced wholesale with the runner's latest complete state, while server-owned
// fields (approval decisions, the approval_event_stream) are preserved/authored
// here because the runner never sends them.
func applyUpdateStatusMerge(
	execution *agentexecutionv1.AgentExecution,
	input *agentexecutionv1.AgentExecutionUpdateStatusInput,
) {
	if execution.Status == nil {
		execution.Status = &agentexecutionv1.AgentExecutionStatus{}
	}
	status := execution.Status
	requestStatus := input.Status

	// Snapshot the pre-merge transcript before any replacement: the transcript
	// regression guard compares against the persisted messages, and
	// PreserveApprovalFields copies the SubmitApproval-owned decision fields from
	// these existing messages onto the incoming ones. Reassigning status.Messages
	// below does not mutate this slice.
	existingMessages := status.GetMessages()
	existingSubAgents := status.GetSubAgentExecutions()
	existingMessageCount := len(existingMessages)
	existingPhase := status.GetPhase()

	// Merge messages (replace with latest from request), guarding against any
	// update that would drop committed transcript history for a non-terminal
	// execution. The runner owns the transcript and only ever GROWS it in flight:
	// new turns are appended and existing entries — including their tool calls —
	// are reconciled in place, never dropped. Two regressions are rejected so a
	// partial or misreconstructed write can never wipe history at this single
	// persistence chokepoint:
	//
	//  1. A strictly SHORTER transcript — the classic partial write (e.g. a
	//     durable-checkpoint resume that rebuilt status from an empty proto).
	//  2. A transcript that DROPS a tool-call id committed earlier while appending
	//     enough later turns to keep the count equal-or-greater. This
	//     front-truncation is invisible to a count-only check, yet it is exactly
	//     how an approve-all resume wiped the leading thinking block + first tool
	//     call (the reported getAppState drop). Tool-call ids are the only stable
	//     identity in the transcript (AgentMessage carries none), so a
	//     previously-present id missing from the incoming update is the reliable
	//     signal that committed history was dropped.
	//
	// Content is deliberately NOT compared: legitimate updates both grow it
	// (streaming) and blank it in place (the Cursor runner's post-denial narration
	// redaction — see clearProvisionalPostDenialNarration in execute-cursor/
	// message-translator.ts), so a content-based check would reject valid writes.
	// Terminal executions may be rewritten freely (e.g. an administrative
	// correction), so the guard is scoped to in-flight executions.
	if len(requestStatus.Messages) > 0 {
		if reject, reason := nonTerminalTranscriptRegression(
			existingPhase, existingMessages, requestStatus.Messages,
		); reject {
			log.Warn().
				Str("execution_id", input.ExecutionId).
				Int("existing_messages", existingMessageCount).
				Int("incoming_messages", len(requestStatus.Messages)).
				Str("reason", reason).
				Msg("Rejected status update that would drop committed transcript history for a non-terminal execution; keeping existing messages")
		} else {
			status.Messages = requestStatus.Messages
		}
	}

	// Merge sub_agent_executions (replace with latest from request)
	if len(requestStatus.SubAgentExecutions) > 0 {
		status.SubAgentExecutions = requestStatus.SubAgentExecutions
	}

	// Merge todos (replace with latest from request)
	if len(requestStatus.Todos) > 0 {
		status.Todos = requestStatus.Todos
	}

	// Merge artifacts (replace with latest from request)
	// Artifacts are published by agents via the publish_artifact tool during execution.
	// When Python agent-runner sends artifacts via updateStatus RPC, they are persisted here.
	if len(requestStatus.Artifacts) > 0 {
		status.Artifacts = requestStatus.Artifacts
	}

	// Merge workspace write-backs (replace with latest from request).
	// Write-backs are populated during post-execution processing when
	// the platform detects git changes and creates PRs.
	if len(requestStatus.WorkspaceWriteBacks) > 0 {
		status.WorkspaceWriteBacks = requestStatus.WorkspaceWriteBacks
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

	// Update phase (if provided)
	if requestStatus.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		status.Phase = requestStatus.Phase
	}

	// Update error (if provided)
	if requestStatus.Error != "" {
		status.Error = requestStatus.Error
	}

	// Update timestamps (if provided)
	if requestStatus.StartedAt != "" {
		status.StartedAt = requestStatus.StartedAt
	}
	if requestStatus.CompletedAt != "" {
		status.CompletedAt = requestStatus.CompletedAt
	}

	// Defense-in-depth: completed_at must not be set for non-terminal phases.
	// The Python agent-runner clears completed_at on resume via ResumeReconciler,
	// but the empty-string merge above cannot propagate the clear because the
	// condition guards against empty values.  This explicit guard prevents the
	// contradictory state (completed_at set + phase=WAITING_FOR_APPROVAL) that
	// was observed in production.
	if status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS ||
		status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL ||
		status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_PENDING {
		status.CompletedAt = ""
	}

	// Author REQUESTED events for any tool call now in the approval gate
	// (seeding the persisted stream the first time it is touched). The runner
	// never sends this server-only field; it is carried over from the loaded
	// resource and mutated in place here. Decisions are authored separately by
	// SubmitApproval. Because this runs inside the UpdateResource write lock on
	// the freshly-loaded stream, the events it appends can never clobber a
	// decision a concurrent SubmitApproval appended.
	approval.EnsureApprovalRequests(status, input.ExecutionId)

	// Compute pending_approvals from the authored event stream, via the single
	// projection seam (returns the event-stream projection and runs the
	// scan parity cross-check).
	status.PendingApprovals = approval.ProjectPendingApprovals(
		status.GetPhase(),
		status.GetMessages(),
		status.GetSubAgentExecutions(),
		status.GetApprovalEventStream(),
	)

	// Recompute file_change_sets from the append-only file_review ledger via its
	// single projection seam. The ledger is server-only (carried over from the
	// loaded resource, never sent by the runner) and authored by the runner's
	// capture/reconcile activities and by SubmitFileDecision; this projection is
	// always derived, never merged, so it cannot go stale. Empty until a producer
	// authors events (Phase 2).
	status.FileChangeSets = filereview.ProjectFileChangeSets(
		status.GetPhase(),
		status.GetFileReviewEventStream(),
	)

	// Merge streaming_usage (replace with latest from request).
	// Populated by execution worker's UsageAccumulator during streaming;
	// used by the frontend as a display-only fallback when proxy-reported
	// usage is unavailable (e.g., Cursor harness).
	if requestStatus.StreamingUsage != nil {
		status.StreamingUsage = requestStatus.StreamingUsage
	}

	// Merge context_info (replace with latest from request)
	if requestStatus.ContextInfo != nil {
		status.ContextInfo = requestStatus.ContextInfo
	}

	// Merge resolved_context (replace with latest from request)
	if requestStatus.ResolvedContext != nil {
		status.ResolvedContext = requestStatus.ResolvedContext
	}

	// Merge setup_progress (replace with latest from request)
	if requestStatus.SetupProgress != nil {
		status.SetupProgress = requestStatus.SetupProgress
	}
	// Clear setup_progress when phase leaves PENDING (defense-in-depth).
	// The worker stops sending setup_progress once streaming begins, but
	// an explicit clear prevents stale data from persisting if the phase
	// transitions via a different code path.
	if status.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PENDING {
		status.SetupProgress = nil
	}

	// Merge structured_output (replace with latest from request).
	// Populated by the runner on COMPLETED when ExecutionConfig had
	// structured_output_schema. Immutable after first population.
	if requestStatus.StructuredOutput != nil {
		status.StructuredOutput = requestStatus.StructuredOutput
	}

	log.Debug().
		Str("execution_id", input.ExecutionId).
		Str("phase", status.Phase.String()).
		Int("messages_count", len(status.Messages)).
		Int("artifacts_count", len(status.Artifacts)).
		Int("write_backs_count", len(status.WorkspaceWriteBacks)).
		Int("pending_approvals_count", len(status.PendingApprovals)).
		Bool("has_context_info", status.ContextInfo != nil).
		Bool("has_resolved_context", status.ResolvedContext != nil).
		Bool("has_setup_progress", status.SetupProgress != nil).
		Bool("has_streaming_usage", status.StreamingUsage != nil).
		Bool("has_structured_output", status.StructuredOutput != nil).
		Msg("Merged status fields")
}

// MergeAndPersistExecutionStep atomically loads the execution, merges the incoming
// status update, and persists the result in a single read-modify-write under the
// store's per-resource write lock (store.UpdateResource).
//
// Doing the load and the save as one atomic unit — rather than a load step
// followed by a separate whole-resource save — is what keeps the append-only
// approval_event_stream correct by construction: an approval event a concurrent
// SubmitApproval appends can never be lost to a stale-read overwrite.
type MergeAndPersistExecutionStep struct {
	store store.Store
}

func newMergeAndPersistExecutionStep(store store.Store) *MergeAndPersistExecutionStep {
	return &MergeAndPersistExecutionStep{store: store}
}

func (s *MergeAndPersistExecutionStep) Name() string {
	return "MergeAndPersistExecution"
}

func (s *MergeAndPersistExecutionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionUpdateStatusInput]) error {
	input := ctx.Input()
	executionID := input.ExecutionId

	log.Debug().
		Str("execution_id", executionID).
		Msg("Merging and persisting execution status")

	updated := &agentexecutionv1.AgentExecution{}
	err := s.store.UpdateResource(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_agent_execution,
		executionID,
		updated,
		func() error {
			applyUpdateStatusMerge(updated, input)
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("AgentExecution", executionID)
		}
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to persist execution with updated status")
		return grpclib.InternalError(err, "failed to update execution status")
	}

	// Hand the merged result to the broadcast step.
	ctx.Set("execution", updated)

	log.Info().
		Str("execution_id", executionID).
		Str("phase", updated.Status.GetPhase().String()).
		Msg("Successfully updated execution status")

	return nil
}

// BroadcastToStreamsStep broadcasts the execution update to all active subscribers
//
// This implements the "Daemon (Streaming): Pushes message to active Go Channels" step
// from ADR 011 Write Path.
//
// After persisting to SQLite, the daemon must push updates to in-memory channels
// so that Subscribe() streams can receive updates in real-time without polling.
type BroadcastToStreamsStep struct {
	broker *StreamBroker
}

func newBroadcastToStreamsStep(broker *StreamBroker) *BroadcastToStreamsStep {
	return &BroadcastToStreamsStep{broker: broker}
}

func (s *BroadcastToStreamsStep) Name() string {
	return "BroadcastToStreams"
}

func (s *BroadcastToStreamsStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionUpdateStatusInput]) error {
	execution, ok := ctx.Get("execution").(*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution not found in context")
	}

	// Broadcast to all active subscribers
	s.broker.Broadcast(execution)

	log.Debug().
		Str("execution_id", execution.Metadata.Id).
		Int("subscribers", s.broker.GetSubscriberCount(execution.Metadata.Id)).
		Msg("Broadcasted execution update to subscribers")

	return nil
}
