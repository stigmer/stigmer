package runner

import (
	"context"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates a Runner based on whether it already exists.
//
// This is the primary registration path for CLI/Desktop runners. The CLI stores
// the runner slug in ~/.stigmer/runner.json. On start or restart, it calls apply:
//   - If the runner does not exist (first registration): delegates to Create
//   - If the runner exists (restart/reconnect): delegates to Update, preserving
//     the existing identity, task queue, and status
//
// Lookup key for existence check: metadata.org + metadata.slug (slug derived
// from metadata.name).
func (c *RunnerController) Apply(ctx context.Context, runner *runnerv1.Runner) (*runnerv1.Runner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runner)

	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	shouldCreate := shouldCreateVal.(bool)

	if shouldCreate {
		log.Info().
			Str("slug", runner.GetMetadata().GetName()).
			Msg("Runner does not exist — delegating to CREATE")
		return c.Create(ctx, runner)
	}

	log.Info().
		Str("slug", runner.GetMetadata().GetName()).
		Str("id", runner.GetMetadata().GetId()).
		Msg("Runner exists — delegating to UPDATE")
	return c.Update(ctx, runner)
}

func (c *RunnerController) buildApplyPipeline() *pipeline.Pipeline[*runnerv1.Runner] {
	return pipeline.NewPipeline[*runnerv1.Runner]("runner-apply").
		AddStep(steps.NewValidateProtoStep[*runnerv1.Runner]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*runnerv1.Runner]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*runnerv1.Runner](c.store)). // 3. Check existence
		Build()
}
