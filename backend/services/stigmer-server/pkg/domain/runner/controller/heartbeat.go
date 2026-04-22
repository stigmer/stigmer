package runner

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Heartbeat reports runner liveness and operational state.
//
// Called by the runner process every 30 seconds. Updates status fields
// (phase, last_heartbeat_at, current_executions, connection_info) without
// modifying spec or metadata.
//
// This handler is fully custom — it does not use the standard pipeline
// framework because:
//   - The input type is RunnerHeartbeatInput (not a Runner resource)
//   - The operation is an atomic read-modify-write on status only
//   - Phase transition logic has domain-specific rules (FAILED gate, reactivation)
//
// Phase transition rules:
//   - PENDING/STOPPED + input READY -> READY (runner starting/restarting)
//   - READY + input BUSY -> BUSY (at capacity)
//   - BUSY + input READY -> READY (capacity freed)
//   - FAILED -> rejected with FAILED_PRECONDITION (requires investigation)
//
// Compared to Stigmer Cloud, OSS excludes:
//   - FGA ownership verification (no IAM in OSS)
func (c *RunnerController) Heartbeat(ctx context.Context, input *runnerv1.RunnerHeartbeatInput) (*runnerv1.Runner, error) {
	runnerID := input.GetRunnerId()
	if runnerID == "" {
		return nil, grpclib.InvalidArgumentError("runner_id is required")
	}

	runner := &runnerv1.Runner{}
	kind := apiresourcekind.ApiResourceKind_runner

	err := c.store.UpdateResource(ctx, kind, runnerID, runner, func() error {
		return applyHeartbeat(runner, input)
	})

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, grpclib.NotFoundError("Runner", runnerID)
		}
		// Domain errors (e.g., FAILED_PRECONDITION) from applyHeartbeat are
		// returned as gRPC status errors. Pass them through unchanged.
		if _, ok := status.FromError(err); ok {
			return nil, err
		}
		return nil, grpclib.InternalError(err, "failed to process heartbeat")
	}

	return runner, nil
}

// applyHeartbeat applies heartbeat-reported state to the runner's status.
//
// This is a pure domain function: it reads the existing runner state and the
// heartbeat input, validates the phase transition, and mutates the runner's
// status in place. Called within store.UpdateResource's atomic read-modify-write.
func applyHeartbeat(runner *runnerv1.Runner, input *runnerv1.RunnerHeartbeatInput) error {
	existingPhase := runner.GetStatus().GetPhase()

	if existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_FAILED {
		log.Warn().
			Str("runner_id", input.GetRunnerId()).
			Msg("Heartbeat rejected: runner is in FAILED phase")
		return grpclib.FailedPreconditionError(
			"Runner is in FAILED phase — heartbeat cannot change state. " +
				"Delete and recreate the runner, or investigate the failure.")
	}

	reportedPhase := input.GetPhase()
	now := time.Now()
	nowTs := timestamppb.New(now)

	existingStatus := runner.GetStatus()
	updatedStatus := proto.Clone(existingStatus).(*runnerv1.RunnerStatus)
	if updatedStatus == nil {
		updatedStatus = &runnerv1.RunnerStatus{}
	}

	updatedStatus.Phase = reportedPhase
	updatedStatus.LastHeartbeatAt = nowTs
	updatedStatus.CurrentExecutions = input.GetCurrentExecutions()

	if input.GetConnectionInfo() != nil {
		updatedStatus.ConnectionInfo = input.GetConnectionInfo()
	}

	isReactivation := (existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_PENDING ||
		existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED) &&
		reportedPhase == runnerv1.RunnerPhase_RUNNER_PHASE_READY

	if isReactivation {
		updatedStatus.StartedAt = nowTs
		updatedStatus.StoppedAt = nil
		log.Info().
			Str("runner_id", input.GetRunnerId()).
			Str("previous_phase", existingPhase.String()).
			Msg("Runner reactivated: transitioning to READY")
	}

	runner.Status = updatedStatus

	log.Debug().
		Str("runner_id", input.GetRunnerId()).
		Str("phase", reportedPhase.String()).
		Int32("current_executions", input.GetCurrentExecutions()).
		Msg("Heartbeat processed")

	return nil
}
