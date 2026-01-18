package agentexecution

import (
	"time"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
)

// Subscribe provides real-time execution updates via gRPC streaming
//
// For OSS: This is a simplified implementation that polls the database.
// In Cloud, this uses Redis Streams for true real-time updates.
//
// Pipeline Steps:
// 1. ValidateSubscribeInput - Validate execution_id is provided
// 2. LoadInitialExecution - Load initial execution state and send to client
// 3. StreamUpdates - Poll for updates and stream to client until terminal state
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Redis Streams (uses polling instead)
//
// TODO: Implement proper streaming with file watchers or similar mechanism
func (c *AgentExecutionController) Subscribe(executionId *agentexecutionv1.AgentExecutionId, stream agentexecutionv1.AgentExecutionQueryController_SubscribeServer) error {
	// Create request context with execution ID input
	reqCtx := pipeline.NewRequestContext(stream.Context(), executionId)

	// Store stream in context for steps to use
	reqCtx.Set("stream", stream)

	// Build pipeline
	p := pipeline.NewPipeline[*agentexecutionv1.AgentExecutionId]("agentexecution-subscribe").
		AddStep(newValidateSubscribeInputStep()).
		AddStep(newLoadInitialExecutionStep(c.store)).
		AddStep(newStreamUpdatesStep(c.store)).
		Build()

	// Execute pipeline
	if err := p.Execute(reqCtx); err != nil {
		return err
	}

	return nil
}

// ValidateSubscribeInputStep validates the subscription input
type ValidateSubscribeInputStep struct{}

func newValidateSubscribeInputStep() *ValidateSubscribeInputStep {
	return &ValidateSubscribeInputStep{}
}

func (s *ValidateSubscribeInputStep) Name() string {
	return "ValidateSubscribeInput"
}

func (s *ValidateSubscribeInputStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionId]) error {
	input := ctx.Input()

	if input == nil || input.Value == "" {
		return grpclib.InvalidArgumentError("execution id is required")
	}

	log.Info().
		Str("execution_id", input.Value).
		Msg("Starting execution subscription")

	return nil
}

// LoadInitialExecutionStep loads the initial execution state and sends it to the client
type LoadInitialExecutionStep struct {
	store *badger.Store
}

func newLoadInitialExecutionStep(store *badger.Store) *LoadInitialExecutionStep {
	return &LoadInitialExecutionStep{store: store}
}

func (s *LoadInitialExecutionStep) Name() string {
	return "LoadInitialExecution"
}

func (s *LoadInitialExecutionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionId]) error {
	executionID := ctx.Input().Value
	stream, ok := ctx.Get("stream").(agentexecutionv1.AgentExecutionQueryController_SubscribeServer)
	if !ok {
		return grpclib.InternalError(nil, "stream not found in context")
	}

	// Verify execution exists
	execution := &agentexecutionv1.AgentExecution{}
	if err := s.store.GetResource(ctx.Context(), "AgentExecution", executionID, execution); err != nil {
		return grpclib.NotFoundError("AgentExecution", executionID)
	}

	// Send initial state
	if err := stream.Send(execution); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to send initial execution state")
		return grpclib.InternalError(err, "failed to send execution state")
	}

	// Store execution in context for next step
	ctx.Set("execution", execution)

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", execution.Status.GetPhase().String()).
		Msg("Sent initial execution state")

	return nil
}

// StreamUpdatesStep polls for updates and streams them to the client
type StreamUpdatesStep struct {
	store *badger.Store
}

func newStreamUpdatesStep(store *badger.Store) *StreamUpdatesStep {
	return &StreamUpdatesStep{store: store}
}

func (s *StreamUpdatesStep) Name() string {
	return "StreamUpdates"
}

func (s *StreamUpdatesStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionId]) error {
	executionID := ctx.Input().Value
	stream, ok := ctx.Get("stream").(agentexecutionv1.AgentExecutionQueryController_SubscribeServer)
	if !ok {
		return grpclib.InternalError(nil, "stream not found in context")
	}

	execution, ok := ctx.Get("execution").(*agentexecutionv1.AgentExecution)
	if !ok {
		return grpclib.InternalError(nil, "execution not found in context")
	}

	// Poll for updates (simplified implementation for OSS)
	// TODO: Replace with proper event-driven mechanism
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	lastPhase := execution.GetStatus().GetPhase()
	lastMessageCount := len(execution.GetStatus().GetMessages())

	for {
		select {
		case <-ctx.Context().Done():
			log.Info().
				Str("execution_id", executionID).
				Msg("Subscription cancelled by client")
			return nil

		case <-ticker.C:
			// Load latest state
			updated := &agentexecutionv1.AgentExecution{}
			if err := s.store.GetResource(ctx.Context(), "AgentExecution", executionID, updated); err != nil {
				log.Error().
					Err(err).
					Str("execution_id", executionID).
					Msg("Failed to load execution during subscription")
				continue
			}

			// Check if execution has changed
			currentPhase := updated.GetStatus().GetPhase()
			currentMessageCount := len(updated.GetStatus().GetMessages())

			if currentPhase != lastPhase || currentMessageCount != lastMessageCount {
				// Send updated state
				if err := stream.Send(updated); err != nil {
					log.Error().
						Err(err).
						Str("execution_id", executionID).
						Msg("Failed to send updated execution state")
					return grpclib.InternalError(err, "failed to send execution updates")
				}

				log.Debug().
					Str("execution_id", executionID).
					Str("phase", currentPhase.String()).
					Int("messages", currentMessageCount).
					Msg("Sent execution update")

				lastPhase = currentPhase
				lastMessageCount = currentMessageCount
			}

			// Check if execution is in terminal state
			if isTerminalPhase(currentPhase) {
				log.Info().
					Str("execution_id", executionID).
					Str("phase", currentPhase.String()).
					Msg("Execution reached terminal state, ending subscription")
				return nil
			}
		}
	}
}

// isTerminalPhase checks if the execution phase is terminal
func isTerminalPhase(phase agentexecutionv1.ExecutionPhase) bool {
	return phase == agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}
