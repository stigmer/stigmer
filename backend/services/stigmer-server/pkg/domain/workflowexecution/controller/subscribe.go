package workflowexecution

import (
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
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
func (c *WorkflowExecutionController) Subscribe(request *workflowexecutionv1.SubscribeWorkflowExecutionRequest, stream workflowexecutionv1.WorkflowExecutionQueryController_SubscribeServer) error {
	// Create request context with execution ID input
	reqCtx := pipeline.NewRequestContext(stream.Context(), request)

	// Store stream in context for steps to use
	reqCtx.Set("stream", stream)

	// Build pipeline
	p := pipeline.NewPipeline[*workflowexecutionv1.SubscribeWorkflowExecutionRequest]("workflowexecution-subscribe").
		AddStep(newValidateSubscribeInputStep()).
		AddStep(newLoadInitialWorkflowExecutionStep(c.store)).
		AddStep(newStreamWorkflowUpdatesStep(c.streamBroker)).
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

func (s *ValidateSubscribeInputStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubscribeWorkflowExecutionRequest]) error {
	input := ctx.Input()

	if input == nil || input.ExecutionId == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}

	log.Info().
		Str("execution_id", input.ExecutionId).
		Msg("Starting workflow execution subscription")

	return nil
}

// LoadInitialWorkflowExecutionStep loads the initial execution state and sends it to the client
type LoadInitialWorkflowExecutionStep struct {
	store *badger.Store
}

func newLoadInitialWorkflowExecutionStep(store *badger.Store) *LoadInitialWorkflowExecutionStep {
	return &LoadInitialWorkflowExecutionStep{store: store}
}

func (s *LoadInitialWorkflowExecutionStep) Name() string {
	return "LoadInitialWorkflowExecution"
}

func (s *LoadInitialWorkflowExecutionStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubscribeWorkflowExecutionRequest]) error {
	executionID := ctx.Input().ExecutionId
	stream, ok := ctx.Get("stream").(workflowexecutionv1.WorkflowExecutionQueryController_SubscribeServer)
	if !ok {
		return grpclib.InternalError(nil, "stream not found in context")
	}

	// Verify execution exists
	execution := &workflowexecutionv1.WorkflowExecution{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow_execution, executionID, execution); err != nil {
		return grpclib.NotFoundError("WorkflowExecution", executionID)
	}

	// Send initial state
	if err := stream.Send(execution); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to send initial workflow execution state")
		return grpclib.InternalError(err, "failed to send execution state")
	}

	// Store execution in context for next step
	ctx.Set("execution", execution)

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", execution.Status.GetPhase().String()).
		Msg("Sent initial workflow execution state")

	return nil
}

// StreamWorkflowUpdatesStep subscribes to the broker's Go channel and streams updates to client
//
// This implements the ADR 011 Read Path:
// - Daemon: Subscribes the request to internal Go Channel
// - Daemon: Streams new events from channel down gRPC pipe to CLI
//
// This provides near-instant updates without polling as specified in the ADR.
type StreamWorkflowUpdatesStep struct {
	broker *StreamBroker
}

func newStreamWorkflowUpdatesStep(broker *StreamBroker) *StreamWorkflowUpdatesStep {
	return &StreamWorkflowUpdatesStep{broker: broker}
}

func (s *StreamWorkflowUpdatesStep) Name() string {
	return "StreamWorkflowUpdates"
}

func (s *StreamWorkflowUpdatesStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.SubscribeWorkflowExecutionRequest]) error {
	executionID := ctx.Input().ExecutionId
	stream, ok := ctx.Get("stream").(workflowexecutionv1.WorkflowExecutionQueryController_SubscribeServer)
	if !ok {
		return grpclib.InternalError(nil, "stream not found in context")
	}

	// Subscribe to broker's channel for this execution
	updatesCh := s.broker.Subscribe(executionID)
	defer s.broker.Unsubscribe(executionID, updatesCh)

	log.Debug().
		Str("execution_id", executionID).
		Msg("Subscribed to workflow execution updates channel")

	// Stream updates from channel until terminal state or client disconnect
	for {
		select {
		case <-ctx.Context().Done():
			log.Info().
				Str("execution_id", executionID).
				Msg("Workflow execution subscription cancelled by client")
			return nil

		case updated, ok := <-updatesCh:
			if !ok {
				// Channel closed (should not happen unless broker closes it)
				log.Warn().
					Str("execution_id", executionID).
					Msg("Workflow execution updates channel closed unexpectedly")
				return nil
			}

			// Send updated state to client
			if err := stream.Send(updated); err != nil {
				log.Error().
					Err(err).
					Str("execution_id", executionID).
					Msg("Failed to send updated workflow execution state")
				return grpclib.InternalError(err, "failed to send execution updates")
			}

			log.Debug().
				Str("execution_id", executionID).
				Str("phase", updated.GetStatus().GetPhase().String()).
				Int("tasks", len(updated.GetStatus().GetTasks())).
				Msg("Sent workflow execution update")

			// Check if execution is in terminal state
			if isWorkflowTerminalPhase(updated.GetStatus().GetPhase()) {
				log.Info().
					Str("execution_id", executionID).
					Str("phase", updated.GetStatus().GetPhase().String()).
					Msg("Workflow execution reached terminal state, ending subscription")
				return nil
			}
		}
	}
}

// isWorkflowTerminalPhase checks if the execution phase is terminal
func isWorkflowTerminalPhase(phase workflowexecutionv1.ExecutionPhase) bool {
	return phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}
