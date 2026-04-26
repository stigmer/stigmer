package activities

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

const (
	// WaitForRunnerReadyActivityName is the activity name for registration.
	WaitForRunnerReadyActivityName = "WaitForRunnerReady"

	ephemeralLabel  = "stigmer.ai/ephemeral"
	pollIntervalSec = 5
)

// WaitForRunnerReadyActivityImpl polls the Runner's phase until an ephemeral
// runner's agent-runner process has connected to Temporal and is ready.
//
// This runs as a Temporal local activity on the Go worker — no cross-queue
// routing, no Python involvement. It queries the store directly.
//
// Scope: only ephemeral runners (stigmer.ai/ephemeral=true) are waited on.
// Persistent runners return immediately; they are validated at dispatch time.
type WaitForRunnerReadyActivityImpl struct {
	store store.Store
}

// NewWaitForRunnerReadyActivityImpl creates a new activity implementation.
func NewWaitForRunnerReadyActivityImpl(s store.Store) *WaitForRunnerReadyActivityImpl {
	return &WaitForRunnerReadyActivityImpl{store: s}
}

// WaitForRunnerReady blocks until the runner reaches READY/BUSY or fails.
//
// For empty runnerID (global queue path) or non-ephemeral runners, this
// returns immediately. For ephemeral runners, it polls the Runner phase
// every 5 seconds until the activity context deadline expires (set by the
// workflow's LocalActivityOptions.StartToCloseTimeout).
func (a *WaitForRunnerReadyActivityImpl) WaitForRunnerReady(ctx context.Context, runnerID string) error {
	if runnerID == "" {
		log.Debug().Msg("No runner ID — using global queue, skipping readiness wait")
		return nil
	}

	runner := &runnerv1.Runner{}
	if err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_runner, runnerID, runner); err != nil {
		return fmt.Errorf("runner '%s' not found during readiness check: %w", runnerID, err)
	}

	if runner.GetMetadata().GetLabels()[ephemeralLabel] != "true" {
		log.Debug().Str("runner_id", runnerID).Msg("Runner is not ephemeral — skipping readiness wait")
		return nil
	}

	log.Info().
		Str("runner_id", runnerID).
		Str("phase", runner.GetStatus().GetPhase().String()).
		Msg("Waiting for ephemeral runner to become ready")

	ticker := time.NewTicker(pollIntervalSec * time.Second)
	defer ticker.Stop()

	for {
		phase := runner.GetStatus().GetPhase()

		switch phase {
		case runnerv1.RunnerPhase_RUNNER_PHASE_READY, runnerv1.RunnerPhase_RUNNER_PHASE_BUSY:
			log.Info().
				Str("runner_id", runnerID).
				Str("phase", phase.String()).
				Msg("Ephemeral runner is ready — proceeding with execution")
			return nil

		case runnerv1.RunnerPhase_RUNNER_PHASE_FAILED:
			return fmt.Errorf(
				"ephemeral runner '%s' provisioning failed — "+
					"the Daytona sandbox could not be created or "+
					"the agent-runner process failed to start", runnerID)

		case runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED:
			return fmt.Errorf(
				"ephemeral runner '%s' was stopped before it could become ready", runnerID)
		}

		// PENDING or UNSPECIFIED — wait and re-poll
		select {
		case <-ctx.Done():
			return fmt.Errorf(
				"timed out waiting for ephemeral runner '%s' to become ready "+
					"(last phase: %s): %w", runnerID, phase.String(), ctx.Err())
		case <-ticker.C:
		}

		runner = &runnerv1.Runner{}
		if err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_runner, runnerID, runner); err != nil {
			return fmt.Errorf("runner '%s' was deleted while waiting for it to become ready: %w", runnerID, err)
		}
	}
}
