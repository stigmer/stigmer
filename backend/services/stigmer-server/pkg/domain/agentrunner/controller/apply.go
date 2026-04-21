package agentrunner

import (
	"context"

	"github.com/rs/zerolog/log"
	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates an AgentRunner based on whether it already exists.
//
// This is the primary registration path for CLI/Desktop runners. The CLI stores
// the runner slug in ~/.stigmer/runner.json. On start or restart, it calls apply:
//   - If the runner does not exist (first registration): delegates to Create
//   - If the runner exists (restart/reconnect): delegates to Update, preserving
//     the existing identity, task queue, and status
//
// Lookup key for existence check: metadata.org + metadata.slug (slug derived
// from metadata.name).
func (c *AgentRunnerController) Apply(ctx context.Context, runner *agentrunnerv1.AgentRunner) (*agentrunnerv1.AgentRunner, error) {
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
			Msg("Agent runner does not exist — delegating to CREATE")
		return c.Create(ctx, runner)
	}

	log.Info().
		Str("slug", runner.GetMetadata().GetName()).
		Str("id", runner.GetMetadata().GetId()).
		Msg("Agent runner exists — delegating to UPDATE")
	return c.Update(ctx, runner)
}

func (c *AgentRunnerController) buildApplyPipeline() *pipeline.Pipeline[*agentrunnerv1.AgentRunner] {
	return pipeline.NewPipeline[*agentrunnerv1.AgentRunner]("agent-runner-apply").
		AddStep(steps.NewValidateProtoStep[*agentrunnerv1.AgentRunner]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*agentrunnerv1.AgentRunner]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*agentrunnerv1.AgentRunner](c.store)). // 3. Check existence
		Build()
}
