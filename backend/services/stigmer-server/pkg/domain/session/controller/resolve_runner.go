package session

import (
	"context"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// resolveDefaultRunnerStep auto-binds a session to the sole READY runner when
// the caller does not provide an explicit runner_id.
//
// This is the OSS equivalent of cloud's auto-provisioned ephemeral runner:
// after T06 every runner listens on its own per-runner task queue, so sessions
// must carry a runner_id for dispatch to route activities correctly.
//
// The step is deliberately conservative:
//   - If runner_id is already set, it is a no-op (respect explicit choice).
//   - If exactly one READY runner exists, bind it automatically.
//   - Otherwise (zero runners, multiple READY runners, only BUSY runners)
//     skip silently — session creation should never fail because of transient
//     runner state. The dispatch layer handles the remaining edge cases.
type resolveDefaultRunnerStep struct {
	store store.Store
}

func newResolveDefaultRunnerStep(store store.Store) *resolveDefaultRunnerStep {
	return &resolveDefaultRunnerStep{store: store}
}

func (s *resolveDefaultRunnerStep) Name() string {
	return "ResolveDefaultRunner"
}

func (s *resolveDefaultRunnerStep) Execute(ctx *pipeline.RequestContext[*sessionv1.Session]) error {
	if ctx.Input().GetSpec().GetRunnerId() != "" {
		return nil
	}

	readyRunner, err := findSoleReadyRunner(ctx.Context(), s.store)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to list runners for auto-bind, skipping")
		return nil
	}
	if readyRunner == nil {
		return nil
	}

	runnerID := readyRunner.GetMetadata().GetId()
	runnerName := readyRunner.GetMetadata().GetName()

	newState := ctx.NewState()
	if newState.Spec == nil {
		newState.Spec = &sessionv1.SessionSpec{}
	}
	newState.Spec.RunnerId = runnerID

	log.Info().
		Str("runner_id", runnerID).
		Str("runner_name", runnerName).
		Msg("Auto-bound session to sole READY runner")

	return nil
}

// findSoleReadyRunner returns the single READY runner when exactly one exists.
// Returns nil (no error) when auto-binding should be skipped: zero runners,
// multiple READY runners, or only non-READY runners.
func findSoleReadyRunner(ctx context.Context, s store.Store) (*runnerv1.Runner, error) {
	data, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_runner)
	if err != nil {
		return nil, err
	}

	var readyRunners []*runnerv1.Runner
	for _, d := range data {
		runner := &runnerv1.Runner{}
		if err := proto.Unmarshal(d, runner); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal runner during auto-bind, skipping entry")
			continue
		}
		if runner.GetStatus().GetPhase() == runnerv1.RunnerPhase_RUNNER_PHASE_READY {
			readyRunners = append(readyRunners, runner)
		}
	}

	if len(readyRunners) == 1 {
		return readyRunners[0], nil
	}

	if len(readyRunners) > 1 {
		log.Debug().
			Int("count", len(readyRunners)).
			Msg("Multiple READY runners found, skipping auto-bind (requires explicit selection)")
	}

	return nil, nil
}
