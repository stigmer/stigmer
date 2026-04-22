package runner

import (
	"time"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// applyHeartbeat applies heartbeat-reported state to the runner's status.
//
// This is a pure domain function: it reads the existing runner state and the
// heartbeat message, validates the phase transition, and mutates the runner's
// status in place. Called within store.UpdateResource's atomic read-modify-write.
//
// Phase transition rules:
//   - PENDING/STOPPED + input READY -> READY (runner starting/restarting)
//   - READY + input BUSY -> BUSY (at capacity)
//   - BUSY + input READY -> READY (capacity freed)
//   - FAILED -> rejected with FAILED_PRECONDITION (requires investigation)
func applyHeartbeat(runner *runnerv1.Runner, heartbeat *runnerv1.RunnerHeartbeat) error {
	existingPhase := runner.GetStatus().GetPhase()

	if existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_FAILED {
		log.Warn().
			Str("runner_id", heartbeat.GetRunnerId()).
			Msg("Heartbeat rejected: runner is in FAILED phase")
		return grpclib.FailedPreconditionError(
			"Runner is in FAILED phase — heartbeat cannot change state. " +
				"Delete and recreate the runner, or investigate the failure.")
	}

	reportedPhase := heartbeat.GetPhase()
	now := time.Now()
	nowTs := timestamppb.New(now)

	existingStatus := runner.GetStatus()
	updatedStatus := proto.Clone(existingStatus).(*runnerv1.RunnerStatus)
	if updatedStatus == nil {
		updatedStatus = &runnerv1.RunnerStatus{}
	}

	updatedStatus.Phase = reportedPhase
	updatedStatus.LastHeartbeatAt = nowTs
	updatedStatus.CurrentExecutions = heartbeat.GetCurrentExecutions()

	if heartbeat.GetConnectionInfo() != nil {
		updatedStatus.ConnectionInfo = heartbeat.GetConnectionInfo()
	}

	isReactivation := (existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_PENDING ||
		existingPhase == runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED) &&
		reportedPhase == runnerv1.RunnerPhase_RUNNER_PHASE_READY

	if isReactivation {
		updatedStatus.StartedAt = nowTs
		updatedStatus.StoppedAt = nil
		log.Info().
			Str("runner_id", heartbeat.GetRunnerId()).
			Str("previous_phase", existingPhase.String()).
			Msg("Runner reactivated: transitioning to READY")
	}

	runner.Status = updatedStatus

	log.Debug().
		Str("runner_id", heartbeat.GetRunnerId()).
		Str("phase", reportedPhase.String()).
		Int32("current_executions", heartbeat.GetCurrentExecutions()).
		Msg("Heartbeat processed")

	return nil
}
