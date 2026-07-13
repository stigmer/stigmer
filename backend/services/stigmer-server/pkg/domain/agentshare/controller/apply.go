package agentshare

import (
	"context"

	"github.com/rs/zerolog/log"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates an agent share based on whether it already exists.
//
// This implements declarative "apply" semantics (similar to kubectl apply):
// the share's slug is resolved first (defaulting to the referenced agent's
// slug when neither slug nor name is provided — the canonical-share
// contract), then existence decides create vs update.
//
// Pipeline (minimal - just for existence check):
//  1. ValidateProto - Validate field constraints
//  2. ResolveShareDefaults - Org invariant + slug default from the agent
//  3. ResolveSlug - Generate slug from metadata.name if still unset
//  4. LoadForApply - Attempt to load existing (doesn't fail if not found)
//
// The heavy lifting (validation, persistence, invariants) is handled by
// the delegated Create or Update handlers.
func (c *AgentShareController) Apply(ctx context.Context, share *agentsharev1.AgentShare) (*agentsharev1.AgentShare, error) {
	reqCtx := pipeline.NewRequestContext(ctx, share)

	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	// Delegate with the pipeline's state, not the original input: the
	// request context clones the input, so the defaulted slug/name (from
	// ResolveShareDefaults) and the populated id (from LoadForApply) live
	// on the clone. The canonical-share manifest legitimately omits both
	// name and slug, so the delegated pipelines depend on these defaults.
	resolved := reqCtx.NewState()

	if shouldCreateVal.(bool) {
		log.Info().
			Str("slug", resolved.GetMetadata().GetSlug()).
			Msg("Agent share does not exist - delegating to CREATE")
		return c.Create(ctx, resolved)
	}

	log.Info().
		Str("slug", resolved.GetMetadata().GetSlug()).
		Str("id", resolved.GetMetadata().GetId()).
		Msg("Agent share exists - delegating to UPDATE")
	return c.Update(ctx, resolved)
}

func (c *AgentShareController) buildApplyPipeline() *pipeline.Pipeline[*agentsharev1.AgentShare] {
	return pipeline.NewPipeline[*agentsharev1.AgentShare]("agent-share-apply").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.AgentShare]()).
		AddStep(&resolveShareDefaultsStep{store: c.store}).
		AddStep(steps.NewResolveSlugStep[*agentsharev1.AgentShare]()).
		AddStep(steps.NewLoadForApplyStep[*agentsharev1.AgentShare](c.store)).
		Build()
}
