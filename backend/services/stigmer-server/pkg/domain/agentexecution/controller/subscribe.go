package agentexecution

import (
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Subscribe provides real-time execution updates via gRPC streaming
//
// This implements the Read Path from ADR 011:
// 1. CLI: Calls grpc_stub.Watch(id) to localhost:50051
// 2. Daemon: Subscribes the request to internal Go Channel
// 3. Daemon: Streams new events from channel down gRPC pipe to CLI
//
// Pipeline Steps:
// 1. ValidateSubscribeInput - Validate execution_id is provided
// 2. LoadInitialExecution - Load initial execution state and send to client
// 3. StreamUpdates - Subscribe to broker's Go channel and stream updates to client
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Redis Streams (uses in-memory Go channels instead per ADR 011)
func (c *AgentExecutionController) Subscribe(executionId *agentexecutionv1.AgentExecutionId, stream agentexecutionv1.AgentExecutionQueryController_SubscribeServer) error {
	// Create request context with execution ID input
	reqCtx := pipeline.NewRequestContext(stream.Context(), executionId)

	// Store stream in context for steps to use
	reqCtx.Set("stream", stream)

	// Build pipeline
	p := pipeline.NewPipeline[*agentexecutionv1.AgentExecutionId]("agentexecution-subscribe").
		AddStep(newValidateSubscribeInputStep()).
		AddStep(newLoadInitialExecutionStep(c.store)).
		AddStep(newStreamUpdatesStep(c.streamBroker)).
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
	store store.Store
}

func newLoadInitialExecutionStep(store store.Store) *LoadInitialExecutionStep {
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
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, execution); err != nil {
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

// StreamUpdatesStep subscribes to the broker's Go channel and streams updates to client
//
// This implements the ADR 011 Read Path:
// - Daemon: Subscribes the request to internal Go Channel
// - Daemon: Streams new events from channel down gRPC pipe to CLI
//
// This provides near-instant updates without polling as specified in the ADR.
type StreamUpdatesStep struct {
	broker *StreamBroker
}

func newStreamUpdatesStep(broker *StreamBroker) *StreamUpdatesStep {
	return &StreamUpdatesStep{broker: broker}
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

	// Subscribe to broker's channel for this execution
	updatesCh := s.broker.Subscribe(executionID)
	defer s.broker.Unsubscribe(executionID, updatesCh)

	log.Debug().
		Str("execution_id", executionID).
		Msg("Subscribed to execution updates channel")

	// Stream updates from channel until terminal state or client disconnect
	for {
		select {
		case <-ctx.Context().Done():
			log.Info().
				Str("execution_id", executionID).
				Msg("Subscription cancelled by client")
			return nil

		case updated, ok := <-updatesCh:
			if !ok {
				// Channel closed (should not happen unless broker closes it)
				log.Warn().
					Str("execution_id", executionID).
					Msg("Updates channel closed unexpectedly")
				return nil
			}

			// Send updated state to client
			if err := stream.Send(updated); err != nil {
				log.Error().
					Err(err).
					Str("execution_id", executionID).
					Msg("Failed to send updated execution state")
				return grpclib.InternalError(err, "failed to send execution updates")
			}

			log.Debug().
				Str("execution_id", executionID).
				Str("phase", updated.GetStatus().GetPhase().String()).
				Int("messages", len(updated.GetStatus().GetMessages())).
				Msg("Sent execution update")

			// Check if execution is in terminal state
			if isTerminalPhase(updated.GetStatus().GetPhase()) {
				log.Info().
					Str("execution_id", executionID).
					Str("phase", updated.GetStatus().GetPhase().String()).
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
