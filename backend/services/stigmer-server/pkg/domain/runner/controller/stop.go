package runner

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Stop implements RunnerCommandController.stop.
//
// Gracefully stops a runner. Two paths:
//
//  1. Connected (active bidi stream): sends a StopRunnerRequest via the
//     command stream, waits for the runner's acknowledgment, and returns
//     the runner resource. The actual STOPPED transition happens
//     asynchronously when the runner sends its final heartbeat and closes
//     the stream (triggering handleDisconnect).
//
//  2. Not connected (offline, PENDING): directly transitions the runner
//     to STOPPED in the store and returns the updated resource.
//
// Idempotent: stopping an already-STOPPED or FAILED runner returns the
// resource as-is without error.
func (c *RunnerController) Stop(
	ctx context.Context,
	input *runnerv1.RunnerStopInput,
) (*runnerv1.Runner, error) {
	runnerID := input.GetRunnerId()
	if runnerID == "" {
		return nil, grpclib.InvalidArgumentError("runner_id is required")
	}

	runner := &runnerv1.Runner{}
	kind := apiresourcekind.ApiResourceKind_runner

	if err := c.store.GetResource(ctx, kind, runnerID, runner); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, grpclib.NotFoundError("Runner", runnerID)
		}
		return nil, grpclib.InternalError(err, "failed to load runner")
	}

	phase := runner.GetStatus().GetPhase()

	if phase == runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED ||
		phase == runnerv1.RunnerPhase_RUNNER_PHASE_FAILED {
		return runner, nil
	}

	if c.streamRegistry.IsConnected(runnerID) {
		return c.stopViaStream(ctx, runnerID, input.GetReason(), runner)
	}

	return c.stopDirectly(ctx, runnerID, runner)
}

// stopViaStream sends a StopRunnerRequest through the bidi command stream
// and waits for the runner's acknowledgment.
func (c *RunnerController) stopViaStream(
	ctx context.Context,
	runnerID string,
	reason string,
	runner *runnerv1.Runner,
) (*runnerv1.Runner, error) {
	request := &runnerv1.RunnerCommandRequest{
		RequestId: uuid.NewString(),
		Command: &runnerv1.RunnerCommandRequest_Stop{
			Stop: &runnerv1.StopRunnerRequest{
				Reason: reason,
			},
		},
	}

	log.Info().
		Str("runner_id", runnerID).
		Str("request_id", request.GetRequestId()).
		Str("reason", reason).
		Msg("Sending stop command to runner via stream")

	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	_, err := c.streamRegistry.SendCommand(ctx, runnerID, request)
	if err != nil {
		return nil, err
	}

	log.Info().
		Str("runner_id", runnerID).
		Msg("Runner acknowledged stop command")

	return runner, nil
}

// stopDirectly transitions an offline runner to STOPPED in the store.
// Used when the runner has no active bidi stream.
func (c *RunnerController) stopDirectly(
	ctx context.Context,
	runnerID string,
	runner *runnerv1.Runner,
) (*runnerv1.Runner, error) {
	kind := apiresourcekind.ApiResourceKind_runner

	err := c.store.UpdateResource(ctx, kind, runnerID, runner, func() error {
		if runner.Status == nil {
			runner.Status = &runnerv1.RunnerStatus{}
		}

		runner.Status.Phase = runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED
		runner.Status.StoppedAt = timestamppb.New(time.Now())

		return nil
	})

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, grpclib.NotFoundError("Runner", runnerID)
		}
		return nil, grpclib.InternalError(err, "failed to stop runner")
	}

	log.Info().
		Str("runner_id", runnerID).
		Msg("Runner stopped directly (was not connected)")

	return runner, nil
}
