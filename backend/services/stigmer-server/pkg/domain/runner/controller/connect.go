package runner

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Connect implements the RunnerCommandController.connect bidi stream RPC.
//
// Stream lifecycle:
//  1. First message must be a RunnerHeartbeat (authenticates via runner_id lookup).
//  2. Server registers the stream in the StreamRegistry for command routing.
//  3. Recv loop processes heartbeats (status updates) and command responses
//     (routed to callers waiting in StreamRegistry.SendCommand).
//  4. On disconnect (EOF, error, or context cancellation): stream is unregistered
//     and the runner is transitioned to STOPPED.
func (c *RunnerController) Connect(stream runnerv1.RunnerCommandController_ConnectServer) error {
	runnerID, err := c.authenticateStream(stream)
	if err != nil {
		return err
	}

	c.streamRegistry.Register(runnerID, stream)
	defer c.handleDisconnect(runnerID)

	log.Info().
		Str("runner_id", runnerID).
		Msg("Runner connected to command stream")

	return c.recvLoop(stream, runnerID)
}

// authenticateStream reads the first message from the stream and validates it.
//
// The first message must be a RunnerHeartbeat with a valid runner_id that
// corresponds to an existing Runner resource. The heartbeat is processed
// (updating runner status) before returning.
func (c *RunnerController) authenticateStream(
	stream runnerv1.RunnerCommandController_ConnectServer,
) (string, error) {
	msg, err := stream.Recv()
	if err != nil {
		if errors.Is(err, io.EOF) {
			return "", status.Error(codes.InvalidArgument, "stream closed before sending first heartbeat")
		}
		return "", status.Errorf(codes.Internal, "failed to receive first message: %v", err)
	}

	heartbeat := msg.GetHeartbeat()
	if heartbeat == nil {
		return "", grpclib.InvalidArgumentError(
			"first message on connect stream must be a heartbeat, got command_response")
	}

	runnerID := heartbeat.GetRunnerId()
	if runnerID == "" {
		return "", grpclib.InvalidArgumentError("runner_id is required in first heartbeat")
	}

	if err := c.processHeartbeat(stream.Context(), heartbeat); err != nil {
		return "", err
	}

	return runnerID, nil
}

// recvLoop reads messages from the stream until it closes or errors.
//
// Heartbeat messages update runner status. Command response messages are
// routed to the caller waiting in the StreamRegistry.
func (c *RunnerController) recvLoop(
	stream runnerv1.RunnerCommandController_ConnectServer,
	runnerID string,
) error {
	for {
		msg, err := stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				log.Info().
					Str("runner_id", runnerID).
					Msg("Runner stream closed gracefully (EOF)")
				return nil
			}

			st, ok := status.FromError(err)
			if ok && st.Code() == codes.Canceled {
				log.Info().
					Str("runner_id", runnerID).
					Msg("Runner stream context cancelled")
				return nil
			}

			log.Warn().
				Err(err).
				Str("runner_id", runnerID).
				Msg("Runner stream recv error")
			return err
		}

		switch payload := msg.GetMessage().(type) {
		case *runnerv1.RunnerStreamClientMessage_Heartbeat:
			if err := c.handleHeartbeat(stream.Context(), runnerID, payload.Heartbeat); err != nil {
				return err
			}

		case *runnerv1.RunnerStreamClientMessage_CommandResponse:
			c.streamRegistry.DeliverResponse(runnerID, payload.CommandResponse)

		default:
			log.Warn().
				Str("runner_id", runnerID).
				Msg("Received unknown message type on connect stream, ignoring")
		}
	}
}

// handleHeartbeat validates and processes a heartbeat received on an established stream.
//
// The runner_id in the heartbeat must match the authenticated runner_id for this
// stream. A mismatch is a protocol violation and terminates the stream.
//
// Heartbeat processing errors are classified as terminal or transient:
//   - Terminal (NOT_FOUND, FAILED_PRECONDITION): return error to close the stream
//   - Transient (store write failure): log and continue
func (c *RunnerController) handleHeartbeat(
	ctx context.Context,
	authenticatedRunnerID string,
	heartbeat *runnerv1.RunnerHeartbeat,
) error {
	if heartbeat.GetRunnerId() != authenticatedRunnerID {
		return grpclib.InvalidArgumentError(
			"runner_id mismatch: stream authenticated as %q but heartbeat contains %q",
			authenticatedRunnerID, heartbeat.GetRunnerId())
	}

	err := c.processHeartbeat(ctx, heartbeat)
	if err == nil {
		c.streamRegistry.UpdateHeartbeatTime(authenticatedRunnerID)
		return nil
	}

	st, ok := status.FromError(err)
	if !ok {
		log.Warn().
			Err(err).
			Str("runner_id", authenticatedRunnerID).
			Msg("Heartbeat processing failed (transient), continuing stream")
		return nil
	}

	switch st.Code() {
	case codes.NotFound, codes.FailedPrecondition:
		return err
	default:
		log.Warn().
			Err(err).
			Str("runner_id", authenticatedRunnerID).
			Str("code", st.Code().String()).
			Msg("Heartbeat processing failed (transient), continuing stream")
		return nil
	}
}

// processHeartbeat performs an atomic read-modify-write on the Runner resource
// to apply the heartbeat-reported state. Reuses the applyHeartbeat domain function.
func (c *RunnerController) processHeartbeat(
	ctx context.Context,
	heartbeat *runnerv1.RunnerHeartbeat,
) error {
	runnerID := heartbeat.GetRunnerId()
	runner := &runnerv1.Runner{}
	kind := apiresourcekind.ApiResourceKind_runner

	err := c.store.UpdateResource(ctx, kind, runnerID, runner, func() error {
		return applyHeartbeat(runner, heartbeat)
	})

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("Runner", runnerID)
		}
		if _, ok := status.FromError(err); ok {
			return err
		}
		return grpclib.InternalError(err, "failed to process heartbeat")
	}

	return nil
}

// handleDisconnect is called (deferred) when the Connect handler exits.
// It unregisters the stream and transitions the runner to STOPPED.
//
// Uses context.Background because the stream's context is already cancelled
// at this point. The STOPPED transition is best-effort — if the store write
// fails, the runner will appear stale until the next connect/heartbeat.
func (c *RunnerController) handleDisconnect(runnerID string) {
	c.streamRegistry.Unregister(runnerID)

	runner := &runnerv1.Runner{}
	kind := apiresourcekind.ApiResourceKind_runner

	err := c.store.UpdateResource(context.Background(), kind, runnerID, runner, func() error {
		existingPhase := runner.GetStatus().GetPhase()

		if existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED ||
			existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_FAILED {
			return nil
		}

		if runner.Status == nil {
			runner.Status = &runnerv1.RunnerStatus{}
		}
		runner.Status.Phase = runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED
		runner.Status.StoppedAt = timestamppb.New(time.Now())

		log.Info().
			Str("runner_id", runnerID).
			Str("previous_phase", existingPhase.String()).
			Msg("Runner disconnected: transitioning to STOPPED")

		return nil
	})

	if err != nil {
		log.Warn().
			Err(err).
			Str("runner_id", runnerID).
			Msg("Failed to transition runner to STOPPED on disconnect (best-effort)")
	}
}
