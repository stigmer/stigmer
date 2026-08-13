package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Create creates a new agent channel using the pipeline framework.
//
// Pipeline:
//  1. ValidateProto - Proto field constraints (incl. the required
//     provider_config oneof and the agent_ref kind CEL rule)
//  2. ResolveChannelDefaults - Require org, normalize agent_ref, enforce
//     the same-org invariant (channels have no cross-org arm), load the
//     referenced agent
//  3. ResolveSlug - Generate slug from metadata.name (no agent-slug
//     default — channels are N-per-agent, see ResolveChannelDefaults)
//  4. CheckDuplicate - Org+slug uniqueness
//  5. BuildNewState - Set ID (ach_ prefix), clear client-provided status,
//     audit fields, default visibility
//  6. InitInstallState - status.install_state = pending_install; after
//     BuildNewState so the status wipe cannot erase it
//  7. NormalizeReferences - Make references absolute (fill org)
//  8. Persist - Save the channel
//
// No search-index step: agent_channel is not_search_indexed by design — a
// channel is connection configuration reached through its agent, not a
// library artifact.
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
// requires can_edit on the referenced agent) and FGA tuple creation.
func (c *AgentChannelController) Create(ctx context.Context, channel *agentchannelv1.AgentChannel) (*agentchannelv1.AgentChannel, error) {
	reqCtx := pipeline.NewRequestContext(ctx, channel)

	p := c.buildCreatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *AgentChannelController) buildCreatePipeline() *pipeline.Pipeline[*agentchannelv1.AgentChannel] {
	return pipeline.NewPipeline[*agentchannelv1.AgentChannel]("agent-channel-create").
		AddStep(steps.NewValidateProtoStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewValidateVisibilityStep[*agentchannelv1.AgentChannel]()). // Reject unsupported visibility levels (fail fast)
		AddStep(&resolveChannelDefaultsStep{store: c.store}).
		AddStep(steps.NewResolveSlugStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewCheckDuplicateStep[*agentchannelv1.AgentChannel](c.store)).
		AddStep(steps.NewBuildNewStateStep[*agentchannelv1.AgentChannel]()).
		AddStep(&initInstallStateStep{}).
		AddStep(steps.NewNormalizeReferencesStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewPersistStep[*agentchannelv1.AgentChannel](c.store)).
		Build()
}
