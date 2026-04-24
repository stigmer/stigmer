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
)

const commandTimeout = 10 * time.Second

// SendCommand implements RunnerCommandController.sendCommand.
//
// Sends a typed command to a connected runner via its bidi stream and returns
// the runner's response synchronously. This is the API entry point for
// UI-triggered runner commands (e.g., ListDirectory for workspace browsing).
//
// The handler validates the request, verifies the runner exists and is in an
// operable phase, then delegates to the StreamRegistry for stream-level
// command routing and response correlation.
func (c *RunnerController) SendCommand(
	ctx context.Context,
	input *runnerv1.RunnerSendCommandInput,
) (*runnerv1.RunnerCommandResponse, error) {
	runnerID := input.GetRunnerId()
	if runnerID == "" {
		return nil, grpclib.InvalidArgumentError("runner_id is required")
	}

	if input.GetCommand() == nil {
		return nil, grpclib.InvalidArgumentError("command is required in sendCommand request")
	}

	if err := c.validateRunnerPhase(ctx, runnerID); err != nil {
		return nil, err
	}

	request := buildCommandRequest(input)

	log.Info().
		Str("runner_id", runnerID).
		Str("request_id", request.GetRequestId()).
		Msg("Sending command to runner")

	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	resp, err := c.streamRegistry.SendCommand(ctx, runnerID, request)
	if err != nil {
		return nil, err
	}

	return resp, nil
}

// validateRunnerPhase loads the runner and checks that its phase allows
// command delivery. Returns user-facing errors for each non-operable phase.
func (c *RunnerController) validateRunnerPhase(ctx context.Context, runnerID string) error {
	runner := &runnerv1.Runner{}
	kind := apiresourcekind.ApiResourceKind_runner

	if err := c.store.GetResource(ctx, kind, runnerID, runner); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("Runner", runnerID)
		}
		return grpclib.InternalError(err, "failed to load runner")
	}

	phase := runner.GetStatus().GetPhase()
	switch phase {
	case runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED:
		return grpclib.FailedPreconditionError(
			"Runner %q is stopped — start it to send commands", runnerID)
	case runnerv1.RunnerPhase_RUNNER_PHASE_PENDING:
		return grpclib.FailedPreconditionError(
			"Runner %q has not connected yet", runnerID)
	case runnerv1.RunnerPhase_RUNNER_PHASE_FAILED:
		return grpclib.FailedPreconditionError(
			"Runner %q is in FAILED phase — delete and recreate", runnerID)
	default:
		return nil
	}
}

// buildCommandRequest creates a RunnerCommandRequest from the public API input,
// generating a unique request_id and copying the command from the input's oneof.
func buildCommandRequest(input *runnerv1.RunnerSendCommandInput) *runnerv1.RunnerCommandRequest {
	req := &runnerv1.RunnerCommandRequest{
		RequestId: uuid.NewString(),
	}

	switch cmd := input.GetCommand().(type) {
	case *runnerv1.RunnerSendCommandInput_ListDirectory:
		req.Command = &runnerv1.RunnerCommandRequest_ListDirectory{
			ListDirectory: cmd.ListDirectory,
		}
	}

	return req
}
