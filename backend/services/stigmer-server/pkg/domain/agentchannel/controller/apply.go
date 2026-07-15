package agentchannel

import (
	"context"

	"github.com/rs/zerolog/log"
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates an agent channel based on whether it already
// exists.
//
// This implements declarative "apply" semantics (similar to kubectl
// apply): channel defaults resolve first — matching the cloud edition,
// which runs its defaults resolver BEFORE routing so the existence check
// sees the normalized spec.agent_ref and the same-org invariant fails
// loudly before any routing — then existence decides create vs update.
// Status is preserved verbatim across apply-as-update (BuildUpdateState),
// so a routine manifest apply can never clobber an install or its
// credentials reference (decision 004).
//
// Pipeline (minimal - just for existence check):
//  1. ValidateProto - Validate field constraints
//  2. ResolveChannelDefaults - Org invariant + agent_ref normalization
//  3. ResolveSlug - Generate slug from metadata.name if still unset
//  4. LoadForApply - Attempt to load existing (doesn't fail if not found)
//
// The heavy lifting (validation, persistence, invariants) is handled by
// the delegated Create or Update handlers. Resolution is idempotent, so
// the create pipeline re-running ResolveChannelDefaults over the resolved
// channel is harmless.
func (c *AgentChannelController) Apply(ctx context.Context, channel *agentchannelv1.AgentChannel) (*agentchannelv1.AgentChannel, error) {
	reqCtx := pipeline.NewRequestContext(ctx, channel)

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
	// request context clones the input, so the normalized agent_ref (from
	// ResolveChannelDefaults) and the populated id (from LoadForApply)
	// live on the clone.
	resolved := reqCtx.NewState()

	if shouldCreateVal.(bool) {
		log.Info().
			Str("slug", resolved.GetMetadata().GetSlug()).
			Msg("Agent channel does not exist - delegating to CREATE")
		return c.Create(ctx, resolved)
	}

	log.Info().
		Str("slug", resolved.GetMetadata().GetSlug()).
		Str("id", resolved.GetMetadata().GetId()).
		Msg("Agent channel exists - delegating to UPDATE")
	return c.Update(ctx, resolved)
}

func (c *AgentChannelController) buildApplyPipeline() *pipeline.Pipeline[*agentchannelv1.AgentChannel] {
	return pipeline.NewPipeline[*agentchannelv1.AgentChannel]("agent-channel-apply").
		AddStep(steps.NewValidateProtoStep[*agentchannelv1.AgentChannel]()).
		AddStep(&resolveChannelDefaultsStep{store: c.store}).
		AddStep(steps.NewResolveSlugStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewLoadForApplyStep[*agentchannelv1.AgentChannel](c.store)).
		Build()
}
