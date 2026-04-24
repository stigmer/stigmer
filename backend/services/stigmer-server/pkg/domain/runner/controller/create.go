package runner

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Create creates a new Runner resource.
//
// Pipeline (Stigmer OSS — simplified from Cloud):
//  1. ValidateFieldConstraints — validate proto field constraints using buf validate
//  2. ResolveSlug — generate slug from metadata.name
//  3. CheckDuplicate — verify no duplicate exists by org + slug
//  4. BuildNewState — generate ID, clear status, set audit fields
//  5. InitializeRunnerStatus — set task_queue ("runner:{id}") and phase PENDING
//  6. Persist — save runner to repository
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - CreateAuthorizationTuples step (no FGA in OSS)
//   - SendResponse step (handler returns directly)
func (c *RunnerController) Create(ctx context.Context, runner *runnerv1.Runner) (*runnerv1.Runner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runner)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *RunnerController) buildCreatePipeline() *pipeline.Pipeline[*runnerv1.Runner] {
	return pipeline.NewPipeline[*runnerv1.Runner]("runner-create").
		AddStep(steps.NewValidateProtoStep[*runnerv1.Runner]()).         // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*runnerv1.Runner]()).           // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*runnerv1.Runner](c.store)). // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*runnerv1.Runner]()).         // 4. Build new state (ID, audit)
		AddStep(&initializeRunnerStatusStep{}).                          // 5. Set task_queue + PENDING
		AddStep(steps.NewPersistStep[*runnerv1.Runner](c.store)).        // 6. Persist
		Build()
}

// initializeRunnerStatusStep sets server-managed status fields on a newly created Runner.
//
// After BuildNewState generates the resource ID, this step sets:
//   - status.task_queue — "runner:{metadata.id}", immutable after create
//   - status.phase — PENDING, waiting for first heartbeat
//
// The task queue name is deterministic from the runner ID and is the routing
// key used by the execution dispatch logic to send work to this runner.
type initializeRunnerStatusStep struct{}

func (s *initializeRunnerStatusStep) Name() string {
	return "InitializeRunnerStatus"
}

func (s *initializeRunnerStatusStep) Execute(ctx *pipeline.RequestContext[*runnerv1.Runner]) error {
	runner := ctx.NewState()
	runnerID := runner.GetMetadata().GetId()
	taskQueue := fmt.Sprintf("runner:%s", runnerID)

	log.Info().
		Str("runner_id", runnerID).
		Str("task_queue", taskQueue).
		Msg("Initializing runner status")

	runner.Status = &runnerv1.RunnerStatus{
		Phase:     runnerv1.RunnerPhase_RUNNER_PHASE_PENDING,
		TaskQueue: taskQueue,
	}

	ctx.SetNewState(runner)
	return nil
}
