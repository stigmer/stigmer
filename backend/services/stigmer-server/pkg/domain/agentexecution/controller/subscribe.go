package agentexecution

import (
	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Subscribe provides real-time execution updates via gRPC streaming
//
// This implements the Read Path from ADR 011:
// 1. CLI: Calls grpc_stub.Watch(id) to localhost:50051
// 2. Daemon: Subscribes the request to internal Go Channel
// 3. Daemon: Streams new events from channel down gRPC pipe to CLI
//
// Pipeline Steps:
//  1. ValidateSubscribeInput - Validate execution_id is provided
//  2. StreamExecution - Register with the broker, send the initial snapshot, then
//     stream live updates to the client until terminal state or disconnect
//
// Registering with the broker and sending the initial snapshot are a SINGLE step
// on purpose. They are one delivery responsibility, and splitting them across two
// steps opened a lossy seam: an update broadcast in the window between the
// snapshot read and the channel registration had no subscriber and was dropped.
// See StreamExecutionStep for the ordering that closes that gap.
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
		AddStep(newStreamExecutionStep(c.store, c.streamBroker)).
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

// StreamExecutionStep registers with the broker, sends the initial execution
// snapshot, and streams live updates to the client until a terminal phase or
// client disconnect.
//
// Register-before-snapshot (the gap fix):
// The broker channel is registered BEFORE the snapshot is read from the store.
// Store writes are serialized under the store's per-resource write lock, and the
// UpdateStatus pipeline broadcasts only AFTER its persist step commits. So any
// commit the snapshot did not observe necessarily commits — and therefore
// broadcasts — after our registration, landing in our channel rather than being
// dropped. The previous two-step shape (load-then-subscribe) lost exactly those
// in-window broadcasts.
//
// Because registration happens first, the channel may also carry the broadcast
// for a commit the snapshot DID observe (an at-or-before-snapshot overlap). That
// frame is equal to the snapshot we just sent — the same persisted object is both
// stored and broadcast — so the consecutive-duplicate guard (sameFrame) drops it.
// The client store ingests snapshots last-write-wins with no version guard, so
// suppressing duplicates here keeps it from re-rendering an identical frame.
//
// Owning both the registration and the stream loop in one step keeps the
// `defer Unsubscribe` leak-free: it fires whether the snapshot load fails or the
// loop returns. The pipeline executor has no cleanup hook, so a single owner is
// the only place this defer can live safely.
type StreamExecutionStep struct {
	store  store.Store
	broker *StreamBroker
}

func newStreamExecutionStep(store store.Store, broker *StreamBroker) *StreamExecutionStep {
	return &StreamExecutionStep{store: store, broker: broker}
}

func (s *StreamExecutionStep) Name() string {
	return "StreamExecution"
}

func (s *StreamExecutionStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecutionId]) error {
	executionID := ctx.Input().Value
	stream, ok := ctx.Get("stream").(agentexecutionv1.AgentExecutionQueryController_SubscribeServer)
	if !ok {
		return grpclib.InternalError(nil, "stream not found in context")
	}

	// Register FIRST so no broadcast can slip through the window before the
	// snapshot read (see the type doc for the happens-before argument).
	updatesCh := s.broker.Subscribe(executionID)
	defer s.broker.Unsubscribe(executionID, updatesCh)

	// Read and send the initial snapshot.
	snapshot := &agentexecutionv1.AgentExecution{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent_execution, executionID, snapshot); err != nil {
		return grpclib.NotFoundError("AgentExecution", executionID)
	}

	if err := stream.Send(snapshot); err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to send initial execution state")
		return grpclib.InternalError(err, "failed to send execution state")
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", snapshot.GetStatus().GetPhase().String()).
		Msg("Sent initial execution state, streaming live updates")

	// lastSent anchors the consecutive-duplicate guard: a frame equal to the
	// most recently delivered frame (starting with the snapshot) is dropped.
	lastSent := snapshot

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

			// Suppress the at-or-before-snapshot overlap frame (and any other
			// exact repeat) so the client never re-renders an identical state.
			if sameFrame(updated, lastSent) {
				continue
			}

			// Send updated state to client
			if err := stream.Send(updated); err != nil {
				log.Error().
					Err(err).
					Str("execution_id", executionID).
					Msg("Failed to send updated execution state")
				return grpclib.InternalError(err, "failed to send execution updates")
			}
			lastSent = updated

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

// sameFrame reports whether two execution frames are value-equal. It is the
// de-dup key for the subscribe stream: AgentExecution carries no monotonic
// revision, but each commit writes the SAME object to both the store and the
// broker, so an overlap broadcast is byte-equal to the snapshot and proto.Equal
// catches it. proto.Equal short-circuits on the first differing field, so the
// common "genuinely new frame" case (a changed phase or message count) is cheap.
func sameFrame(a, b *agentexecutionv1.AgentExecution) bool {
	return proto.Equal(a, b)
}

// isTerminalPhase checks if the execution phase is terminal
func isTerminalPhase(phase agentexecutionv1.ExecutionPhase) bool {
	return phase == agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}
