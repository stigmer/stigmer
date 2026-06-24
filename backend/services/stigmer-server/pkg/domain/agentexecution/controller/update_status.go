package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
	"google.golang.org/protobuf/proto"
)

// UpdateStatus updates execution status during agent execution
//
// Used by agent-runner to send progressive status updates (messages, tool_calls, phase, etc.)
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
func (c *AgentExecutionController) UpdateStatus(ctx context.Context, input *agentexecutionv1.AgentExecutionUpdateStatusInput) (*agentexecutionv1.UpdateStatusResponse, error) {
	// Create request context with input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build pipeline
	p := pipeline.NewPipeline[*agentexecutionv1.AgentExecutionUpdateStatusInput]("agentexecution-update-status").
		AddStep(newValidateUpdateStatusInputStep()).
		AddStep(newLoadExistingExecutionStep(c.store)).
		AddStep(newBuildNewStateWithStatusStep()).
		AddStep(newPersistExecutionStep(c.store)).
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

func (s *LoadExistingExecutionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionUpdateStatusInput]) error {
	input := ctx.Input()
	executionID := input.ExecutionId

	log.Debug().
		Str("execution_id", executionID).
		Msg("Loading existing execution")

	existing := &agentexecutionv1.AgentExecution{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, existing); err != nil {
		return grpclib.NotFoundError("AgentExecution", executionID)
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
// - Replaces messages, tool_calls, sub_agent_executions, todos arrays
// - Updates phase, error, timestamps if provided
// - Preserves spec from existing execution (does NOT update spec)
type BuildNewStateWithStatusStep struct{}

func newBuildNewStateWithStatusStep() *BuildNewStateWithStatusStep {
	return &BuildNewStateWithStatusStep{}
}

func (s *BuildNewStateWithStatusStep) Name() string {
	return "BuildNewStateWithStatus"
}

func (s *BuildNewStateWithStatusStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionUpdateStatusInput]) error {
	input := ctx.Input()
	existing, ok := ctx.Get("existingExecution").(*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "existing execution not found in context")
	}

	// Start with existing execution as base (cloning)
	updated := proto.Clone(existing).(*agentexecutionv1.AgentExecution)

	// Ensure status is initialized
	if updated.Status == nil {
		updated.Status = &agentexecutionv1.AgentExecutionStatus{}
	}

	requestStatus := input.Status

	// CRITICAL: Merge status from input (for progressive updates from agent-runner)
	// Following Java implementation's merge strategy

	// Merge messages (replace with latest from request).
	//
	// Append-only guard: the runner owns the transcript and, during normal
	// streaming, only ever grows it — so a shorter incoming list for a
	// non-terminal execution signals a regressed/partial write (e.g. a
	// durable-checkpoint resume that rebuilt status from an empty proto).
	// Replacing wholesale in that case would wipe history — the failure this
	// guard makes structurally impossible at the single persistence chokepoint.
	//
	// The one legitimate shrink is the runner<->backend approval-finalize
	// contract: when a turn pauses for HITL approval, the runner persists an
	// authoritative WAITING_FOR_APPROVAL transcript that deliberately trims the
	// model's post-denial narration so it matches the native-harness shape
	// ([pre-tool text][gated tool calls WAITING_APPROVAL]). That reshape is
	// shorter than the in-progress transcript already streamed, but it is the
	// source of truth — rejecting it strands the execution at
	// WAITING_FOR_APPROVAL with pending_approvals=0, which the workflow then
	// tight-loops on. We therefore accept a shrink when (and only when) the
	// INCOMING phase is WAITING_FOR_APPROVAL. See the runner's
	// dropProvisionalPostDenialNarration (execute-cursor/message-translator.ts),
	// the other side of this contract.
	if len(requestStatus.Messages) > 0 {
		existingCount := len(existing.Status.GetMessages())
		wouldShrink := len(requestStatus.Messages) < existingCount
		isApprovalFinalize := requestStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
		if wouldShrink && !isTerminalPhase(existing.Status.GetPhase()) && !isApprovalFinalize {
			log.Warn().
				Str("execution_id", input.ExecutionId).
				Int("existing_messages", existingCount).
				Int("incoming_messages", len(requestStatus.Messages)).
				Msg("Rejected status update that would shrink the message transcript for a non-terminal execution; keeping existing messages")
		} else {
			updated.Status.Messages = requestStatus.Messages
		}
	}

	// Merge sub_agent_executions (replace with latest from request)
	if len(requestStatus.SubAgentExecutions) > 0 {
		updated.Status.SubAgentExecutions = requestStatus.SubAgentExecutions
	}

	// Merge todos (replace with latest from request)
	if len(requestStatus.Todos) > 0 {
		updated.Status.Todos = requestStatus.Todos
	}

	// Merge artifacts (replace with latest from request)
	// Artifacts are published by agents via the publish_artifact tool during execution.
	// When Python agent-runner sends artifacts via updateStatus RPC, they are persisted here.
	if len(requestStatus.Artifacts) > 0 {
		updated.Status.Artifacts = requestStatus.Artifacts
	}

	// Merge workspace write-backs (replace with latest from request).
	// Write-backs are populated during post-execution processing when
	// the platform detects git changes and creates PRs.
	if len(requestStatus.WorkspaceWriteBacks) > 0 {
		updated.Status.WorkspaceWriteBacks = requestStatus.WorkspaceWriteBacks
	}

	// Preserve approval fields (approval_action, approval_decided_at, approved_by)
	// that were atomically recorded by SubmitApproval. Python always sends
	// UNSPECIFIED for these fields, so without this step the wholesale message
	// replacement above would erase user-submitted approval decisions.
	approval.PreserveApprovalFields(
		updated.Status.GetMessages(),
		updated.Status.GetSubAgentExecutions(),
		existing.Status.GetMessages(),
		existing.Status.GetSubAgentExecutions(),
	)

	// Update phase (if provided)
	if requestStatus.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		updated.Status.Phase = requestStatus.Phase
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

	// Defense-in-depth: completed_at must not be set for non-terminal phases.
	// The Python agent-runner clears completed_at on resume via ResumeReconciler,
	// but the empty-string merge above cannot propagate the clear because the
	// condition guards against empty values.  This explicit guard prevents the
	// contradictory state (completed_at set + phase=WAITING_FOR_APPROVAL) that
	// was observed in production.
	if updated.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS ||
		updated.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL ||
		updated.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_PENDING {
		updated.Status.CompletedAt = ""
	}

	// Compute pending_approvals from tool call state in messages
	updated.Status.PendingApprovals = approval.ComputePendingApprovals(
		updated.Status.GetMessages(),
		updated.Status.GetSubAgentExecutions(),
	)

	// Merge streaming_usage (replace with latest from request).
	// Populated by execution worker's UsageAccumulator during streaming;
	// used by the frontend as a display-only fallback when proxy-reported
	// usage is unavailable (e.g., Cursor harness).
	if requestStatus.StreamingUsage != nil {
		updated.Status.StreamingUsage = requestStatus.StreamingUsage
	}

	// Merge context_info (replace with latest from request)
	if requestStatus.ContextInfo != nil {
		updated.Status.ContextInfo = requestStatus.ContextInfo
	}

	// Merge resolved_context (replace with latest from request)
	if requestStatus.ResolvedContext != nil {
		updated.Status.ResolvedContext = requestStatus.ResolvedContext
	}

	// Merge setup_progress (replace with latest from request)
	if requestStatus.SetupProgress != nil {
		updated.Status.SetupProgress = requestStatus.SetupProgress
	}
	// Clear setup_progress when phase leaves PENDING (defense-in-depth).
	// The worker stops sending setup_progress once streaming begins, but
	// an explicit clear prevents stale data from persisting if the phase
	// transitions via a different code path.
	if updated.Status.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PENDING {
		updated.Status.SetupProgress = nil
	}

	// Merge structured_output (replace with latest from request).
	// Populated by the runner on COMPLETED when ExecutionConfig had
	// structured_output_schema. Immutable after first population.
	if requestStatus.StructuredOutput != nil {
		updated.Status.StructuredOutput = requestStatus.StructuredOutput
	}

	log.Debug().
		Str("execution_id", input.ExecutionId).
		Str("phase", updated.Status.Phase.String()).
		Int("messages_count", len(updated.Status.Messages)).
		Int("artifacts_count", len(updated.Status.Artifacts)).
		Int("write_backs_count", len(updated.Status.WorkspaceWriteBacks)).
		Int("pending_approvals_count", len(updated.Status.PendingApprovals)).
		Bool("has_context_info", updated.Status.ContextInfo != nil).
		Bool("has_resolved_context", updated.Status.ResolvedContext != nil).
		Bool("has_setup_progress", updated.Status.SetupProgress != nil).
		Bool("has_streaming_usage", updated.Status.StreamingUsage != nil).
		Bool("has_structured_output", updated.Status.StructuredOutput != nil).
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

func (s *PersistExecutionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionUpdateStatusInput]) error {
	execution, ok := ctx.Get("execution").(*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution not found in context")
	}

	executionID := execution.Metadata.Id

	if err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, execution); err != nil {
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
