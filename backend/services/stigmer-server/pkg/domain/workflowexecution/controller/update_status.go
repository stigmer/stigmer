package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// UpdateStatus updates execution status during workflow execution
//
// Used by workflow-runner to send progressive status updates (tasks, phase, etc.)
// This RPC is optimized for frequent status updates and merges status fields with existing state.
//
// Pipeline Steps:
// 1. ValidateInput - Validate execution_id and status are provided
// 2. LoadExisting - Load existing execution from DB
// 3. BuildNewStateWithStatus - Merge status updates from input
// 4. Persist - Save to database
// 5. BroadcastToStreams - Push update to active Go channels (ADR 011)
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - PublishToRedis step (no Redis in OSS - uses in-memory Go channels instead per ADR 011)
// - Publish step (no event publishing in OSS)
func (c *WorkflowExecutionController) UpdateStatus(ctx context.Context, input *workflowexecutionv1.WorkflowExecutionUpdateStatusInput) (*workflowexecutionv1.WorkflowExecution, error) {
	// Create request context with input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build pipeline
	p := pipeline.NewPipeline[*workflowexecutionv1.WorkflowExecutionUpdateStatusInput]("workflowexecution-update-status").
		AddStep(newValidateUpdateStatusInputStep()).
		AddStep(newLoadExistingExecutionStep(c.store)).
		AddStep(newBuildNewStateWithStatusStep()).
		AddStep(newPersistExecutionStep(c.store)).
		AddStep(newPersistEventsStep(c.store)).
		AddStep(newBroadcastToStreamsStep(c.streamBroker)).
		Build()

	// Execute pipeline
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Return updated execution from context
	execution, ok := reqCtx.Get("execution").(*workflowexecutionv1.WorkflowExecution)
	if !ok {
		return nil, grpclib.InternalError(nil, "execution not found in context after pipeline")
	}

	return execution, nil
}

// mergePendingByChild performs a per-child upsert of a workflow status list
// (pending_approvals or pending_file_reviews): it drops the existing entries that
// belong to scopeChildID and appends the incoming entries (which must all belong
// to scopeChildID). Every other child's entries are preserved untouched, so
// parallel child agents surfacing/clearing their own gates never clobber each
// other. An empty incoming slice therefore clears just scopeChildID's entries.
//
// childOf extracts an entry's owning child_agent_execution_id. Kept generic so the
// approval and file-review lists share exactly one merge semantic.
func mergePendingByChild[T any](existing, incoming []T, childOf func(T) string, scopeChildID string) []T {
	merged := make([]T, 0, len(existing)+len(incoming))
	for _, e := range existing {
		if childOf(e) != scopeChildID {
			merged = append(merged, e)
		}
	}
	return append(merged, incoming...)
}

// ValidateUpdateStatusInputStep validates the input for UpdateStatus
type ValidateUpdateStatusInputStep struct{}

func newValidateUpdateStatusInputStep() *ValidateUpdateStatusInputStep {
	return &ValidateUpdateStatusInputStep{}
}

func (s *ValidateUpdateStatusInputStep) Name() string {
	return "ValidateUpdateStatusInput"
}

func (s *ValidateUpdateStatusInputStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecutionUpdateStatusInput]) error {
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

// LoadExistingExecutionStep loads the existing execution from database
type LoadExistingExecutionStep struct {
	store store.Store
}

func newLoadExistingExecutionStep(store store.Store) *LoadExistingExecutionStep {
	return &LoadExistingExecutionStep{store: store}
}

func (s *LoadExistingExecutionStep) Name() string {
	return "LoadExistingExecution"
}

func (s *LoadExistingExecutionStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecutionUpdateStatusInput]) error {
	input := ctx.Input()
	executionID := input.ExecutionId

	log.Debug().
		Str("execution_id", executionID).
		Msg("Loading existing execution")

	existing := &workflowexecutionv1.WorkflowExecution{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_execution, executionID, existing); err != nil {
		return grpclib.NotFoundError("WorkflowExecution", executionID)
	}

	// Store existing execution in context for merge step
	ctx.Set("existingExecution", existing)

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", existing.Status.GetPhase().String()).
		Msg("Loaded existing execution")

	return nil
}

// BuildNewStateWithStatusStep merges status updates from input with existing execution
//
// This step follows the Java implementation's merge logic:
// - Replaces tasks array
// - Updates phase, output, error, timestamps if provided
// - Preserves spec from existing execution (does NOT update spec)
type BuildNewStateWithStatusStep struct{}

func newBuildNewStateWithStatusStep() *BuildNewStateWithStatusStep {
	return &BuildNewStateWithStatusStep{}
}

func (s *BuildNewStateWithStatusStep) Name() string {
	return "BuildNewStateWithStatus"
}

func (s *BuildNewStateWithStatusStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecutionUpdateStatusInput]) error {
	input := ctx.Input()
	existing, ok := ctx.Get("existingExecution").(*workflowexecutionv1.WorkflowExecution)
	if !ok {
		return grpclib.InternalError(nil, "existing execution not found in context")
	}

	// Start with existing execution as base (cloning)
	updated := proto.Clone(existing).(*workflowexecutionv1.WorkflowExecution)

	// Ensure status is initialized
	if updated.Status == nil {
		updated.Status = &workflowexecutionv1.WorkflowExecutionStatus{}
	}

	requestStatus := input.Status

	// CRITICAL: Merge status from input (for progressive updates from workflow-runner)
	// Following Java implementation's merge strategy

	// Merge tasks (replace with latest from request)
	if len(requestStatus.Tasks) > 0 {
		updated.Status.Tasks = requestStatus.Tasks
	}

	// Update phase (if provided)
	if requestStatus.Phase != workflowexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		updated.Status.Phase = requestStatus.Phase
	}

	// Update output (if provided)
	if requestStatus.Output != nil {
		updated.Status.Output = requestStatus.Output
	}

	// Update error (if provided)
	if requestStatus.Error != "" {
		updated.Status.Error = requestStatus.Error
	}

	// Update timestamps (if provided)
	if requestStatus.StartedAt != "" {
		updated.Status.StartedAt = requestStatus.StartedAt
	}
	if requestStatus.CompletedAt != "" {
		updated.Status.CompletedAt = requestStatus.CompletedAt
	}

	// Update temporal workflow ID (if provided)
	if requestStatus.TemporalWorkflowId != "" {
		updated.Status.TemporalWorkflowId = requestStatus.TemporalWorkflowId
	}

	// Update cost/token totals (if provided, runner accumulates across tasks)
	if requestStatus.TotalCostMicros > 0 {
		updated.Status.TotalCostMicros = requestStatus.TotalCostMicros
	}
	if requestStatus.TotalInputTokens > 0 {
		updated.Status.TotalInputTokens = requestStatus.TotalInputTokens
	}
	if requestStatus.TotalOutputTokens > 0 {
		updated.Status.TotalOutputTokens = requestStatus.TotalOutputTokens
	}

	// Guarded, per-child merge: only touch pending_approvals / pending_file_reviews
	// when explicitly requested, and even then replace only the entries for the
	// scoped child (pending_update_child_agent_execution_id), preserving every
	// sibling child's entries. This both prevents event emissions (which don't
	// include these lists) from clobbering active gates set by call-agent-status,
	// and prevents parallel child agents from clobbering each other's gates. A
	// scoped write with an empty incoming list clears just that child's entries.
	scopeChildID := input.GetPendingUpdateChildAgentExecutionId()
	if input.UpdatePendingApprovals {
		updated.Status.PendingApprovals = mergePendingByChild(
			updated.Status.GetPendingApprovals(),
			requestStatus.GetPendingApprovals(),
			func(pa *workflowexecutionv1.WorkflowPendingApproval) string { return pa.GetChildAgentExecutionId() },
			scopeChildID,
		)
	}
	if input.UpdatePendingFileReviews {
		updated.Status.PendingFileReviews = mergePendingByChild(
			updated.Status.GetPendingFileReviews(),
			requestStatus.GetPendingFileReviews(),
			func(fr *workflowexecutionv1.WorkflowPendingFileReview) string { return fr.GetChildAgentExecutionId() },
			scopeChildID,
		)
	}

	log.Debug().
		Str("execution_id", input.ExecutionId).
		Str("phase", updated.Status.Phase.String()).
		Int("tasks_count", len(updated.Status.Tasks)).
		Int("pending_approvals_count", len(updated.Status.PendingApprovals)).
		Int("pending_file_reviews_count", len(updated.Status.PendingFileReviews)).
		Msg("Merged status fields")

	// Store merged execution in context for persist step
	ctx.Set("execution", updated)

	return nil
}

// PersistExecutionStep saves the execution to database
type PersistExecutionStep struct {
	store store.Store
}

func newPersistExecutionStep(store store.Store) *PersistExecutionStep {
	return &PersistExecutionStep{store: store}
}

func (s *PersistExecutionStep) Name() string {
	return "PersistExecution"
}

func (s *PersistExecutionStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecutionUpdateStatusInput]) error {
	execution, ok := ctx.Get("execution").(*workflowexecutionv1.WorkflowExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution not found in context")
	}

	executionID := execution.Metadata.Id

	if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_execution, executionID, execution); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to persist execution with updated status")
		return grpclib.InternalError(err, "failed to update execution status")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("phase", execution.Status.Phase.String()).
		Msg("Successfully updated execution status")

	return nil
}

// PersistEventsStep appends workflow execution events to the event log.
// Events are supplementary — a failure here logs a warning but does NOT
// fail the pipeline because status persistence already succeeded.
type PersistEventsStep struct {
	store store.Store
}

func newPersistEventsStep(store store.Store) *PersistEventsStep {
	return &PersistEventsStep{store: store}
}

func (s *PersistEventsStep) Name() string {
	return "PersistEvents"
}

func (s *PersistEventsStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecutionUpdateStatusInput]) error {
	input := ctx.Input()
	events := input.GetEvents()
	if len(events) == 0 {
		return nil
	}

	executionID := input.ExecutionId

	records := make([]*store.WorkflowExecutionEventRecord, 0, len(events))
	for _, evt := range events {
		data, err := proto.Marshal(evt)
		if err != nil {
			log.Warn().
				Err(err).
				Str("execution_id", executionID).
				Uint64("sequence_number", evt.GetSequenceNumber()).
				Msg("Failed to marshal event, skipping batch")
			return nil
		}

		records = append(records, &store.WorkflowExecutionEventRecord{
			ExecutionID:    executionID,
			SequenceNumber: int64(evt.GetSequenceNumber()),
			EventType:      evt.GetEventType().String(),
			TaskName:       evt.GetTaskName(),
			Data:           data,
		})
	}

	appended, err := s.store.AppendWorkflowExecutionEvents(ctx.Context(), executionID, records)
	if err != nil {
		log.Warn().
			Err(err).
			Str("execution_id", executionID).
			Int("event_count", len(records)).
			Msg("Failed to persist execution events (non-fatal)")
		return nil
	}

	log.Debug().
		Str("execution_id", executionID).
		Int("appended", appended).
		Msg("Persisted execution events")

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

func (s *BroadcastToStreamsStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecutionUpdateStatusInput]) error {
	execution, ok := ctx.Get("execution").(*workflowexecutionv1.WorkflowExecution)
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
