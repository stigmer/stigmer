package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
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
func (c *AgentExecutionController) UpdateStatus(ctx context.Context, input *agentexecutionv1.AgentExecutionUpdateStatusInput) (*agentexecutionv1.AgentExecution, error) {
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

	// Return updated execution from context
	execution, ok := reqCtx.Get("execution").(*agentexecutionv1.AgentExecution)
	if !ok {
		return nil, grpclib.InternalError(nil, "execution not found in context after pipeline")
	}

	return execution, nil
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

	// Merge messages (replace with latest from request)
	if len(requestStatus.Messages) > 0 {
		updated.Status.Messages = requestStatus.Messages
	}

	// Merge tool_calls (replace with latest from request)
	if len(requestStatus.ToolCalls) > 0 {
		updated.Status.ToolCalls = requestStatus.ToolCalls
	}

	// Merge sub_agent_executions (replace with latest from request)
	if len(requestStatus.SubAgentExecutions) > 0 {
		updated.Status.SubAgentExecutions = requestStatus.SubAgentExecutions
	}

	// Merge todos (replace with latest from request)
	if len(requestStatus.Todos) > 0 {
		updated.Status.Todos = requestStatus.Todos
	}

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

	log.Debug().
		Str("execution_id", input.ExecutionId).
		Str("phase", updated.Status.Phase.String()).
		Int("messages_count", len(updated.Status.Messages)).
		Int("tool_calls_count", len(updated.Status.ToolCalls)).
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
