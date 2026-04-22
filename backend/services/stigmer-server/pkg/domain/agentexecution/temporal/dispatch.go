package temporal

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// DispatchResult holds the resolved Temporal task queue and Runner ID for
// routing Python activities. Every successful dispatch now resolves to a
// specific runner — the global shared queue is no longer used.
type DispatchResult struct {
	TaskQueue string
	RunnerID  string
}

// HasRunner returns true when dispatch resolved to a specific Runner.
func (d DispatchResult) HasRunner() bool {
	return d.RunnerID != ""
}

// ResolveActivityTaskQueue determines which Temporal task queue an execution's
// Python activities should be routed to.
//
// Resolution logic (two paths):
//
// Explicit binding — session has a runner_id:
//  1. Load the Runner by ID.
//  2. Verify it is in an active phase (READY or BUSY).
//  3. Return its per-runner task queue.
//  4. Error if the runner is missing, inactive, or has no queue.
//
// Auto-route — session has no runner_id (or no session):
//  1. Scan all runners for active ones (READY or BUSY).
//  2. Prefer READY over BUSY.
//  3. Return the best candidate's task queue.
//  4. Error if no active runner exists (fail fast with actionable message).
func ResolveActivityTaskQueue(ctx context.Context, s store.Store, sessionID string) (DispatchResult, error) {
	if sessionID == "" {
		log.Debug().Msg("No session ID provided, resolving by available runner")
		return resolveByAvailableRunner(ctx, s)
	}

	session := &sessionv1.Session{}
	if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Warn().Str("session_id", sessionID).
				Msg("Session not found during dispatch, resolving by available runner")
			return resolveByAvailableRunner(ctx, s)
		}
		return DispatchResult{}, fmt.Errorf("failed to load session for dispatch: %w", err)
	}

	runnerID := session.GetSpec().GetRunnerId()
	if runnerID == "" {
		log.Debug().Str("session_id", sessionID).
			Msg("Session has no bound runner, resolving by available runner")
		return resolveByAvailableRunner(ctx, s)
	}

	return resolveByExplicitRunner(ctx, s, sessionID, runnerID)
}

// resolveByExplicitRunner loads the runner that a session is explicitly bound
// to and verifies it can accept work.
func resolveByExplicitRunner(ctx context.Context, s store.Store, sessionID, runnerID string) (DispatchResult, error) {
	runner := &runnerv1.Runner{}
	if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_runner, runnerID, runner); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return DispatchResult{}, fmt.Errorf(
				"runner '%s' not found — it may have been deleted", runnerID)
		}
		return DispatchResult{}, fmt.Errorf("failed to load runner for dispatch: %w", err)
	}

	phase := runner.GetStatus().GetPhase()
	if !isActivePhase(phase) {
		return DispatchResult{}, fmt.Errorf(
			"runner '%s' is in %s phase and cannot accept work",
			runner.GetMetadata().GetName(), formatPhase(phase))
	}

	taskQueue := runner.GetStatus().GetTaskQueue()
	if taskQueue == "" {
		return DispatchResult{}, fmt.Errorf(
			"runner '%s' has no task queue configured", runnerID)
	}

	log.Info().
		Str("session_id", sessionID).
		Str("runner_id", runnerID).
		Str("phase", phase.String()).
		Str("task_queue", taskQueue).
		Msg("Dispatch resolved to explicitly bound runner")

	return DispatchResult{TaskQueue: taskQueue, RunnerID: runnerID}, nil
}

// resolveByAvailableRunner scans all runners and picks the best active
// candidate. Prefers READY over BUSY. Returns a descriptive error when no
// active runner can accept work.
func resolveByAvailableRunner(ctx context.Context, s store.Store) (DispatchResult, error) {
	data, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_runner)
	if err != nil {
		return DispatchResult{}, fmt.Errorf("failed to list runners for dispatch: %w", err)
	}

	if len(data) == 0 {
		return DispatchResult{}, fmt.Errorf(
			"no runners registered — start one with 'stigmer up' or 'stigmer up runner'")
	}

	var bestReady, bestBusy *runnerv1.Runner
	totalCount := 0

	for _, d := range data {
		runner := &runnerv1.Runner{}
		if err := proto.Unmarshal(d, runner); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal runner during dispatch scan, skipping entry")
			continue
		}
		totalCount++

		switch runner.GetStatus().GetPhase() {
		case runnerv1.RunnerPhase_RUNNER_PHASE_READY:
			if bestReady == nil {
				bestReady = runner
			}
		case runnerv1.RunnerPhase_RUNNER_PHASE_BUSY:
			if bestBusy == nil {
				bestBusy = runner
			}
		}
	}

	selected := bestReady
	if selected == nil {
		selected = bestBusy
	}

	if selected == nil {
		return DispatchResult{}, fmt.Errorf(
			"no active runners available (found %d runner(s), none in READY phase) — "+
				"check with 'stigmer list runners' and restart with 'stigmer up'",
			totalCount)
	}

	taskQueue := selected.GetStatus().GetTaskQueue()
	if taskQueue == "" {
		return DispatchResult{}, fmt.Errorf(
			"runner '%s' has no task queue configured",
			selected.GetMetadata().GetName())
	}

	runnerID := selected.GetMetadata().GetId()
	log.Info().
		Str("runner_id", runnerID).
		Str("runner_name", selected.GetMetadata().GetName()).
		Str("phase", selected.GetStatus().GetPhase().String()).
		Str("task_queue", taskQueue).
		Msg("Dispatch auto-routed to available runner")

	return DispatchResult{TaskQueue: taskQueue, RunnerID: runnerID}, nil
}

func isActivePhase(phase runnerv1.RunnerPhase) bool {
	return phase == runnerv1.RunnerPhase_RUNNER_PHASE_READY ||
		phase == runnerv1.RunnerPhase_RUNNER_PHASE_BUSY
}

func formatPhase(phase runnerv1.RunnerPhase) string {
	switch phase {
	case runnerv1.RunnerPhase_RUNNER_PHASE_PENDING:
		return "PENDING"
	case runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED:
		return "STOPPED"
	case runnerv1.RunnerPhase_RUNNER_PHASE_FAILED:
		return "FAILED"
	default:
		return phase.String()
	}
}
