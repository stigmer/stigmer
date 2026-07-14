package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing agent channel using the pipeline framework.
//
// The spec is replaced wholesale (declarative semantics): a manifest that
// omits enabled disables serving — fails closed, matching every other
// resource. status is preserved verbatim from the existing channel, which
// is the guarantee that keeps the install facts and credentials reference
// immune to declarative clobber (the install flow is their sole writer —
// decision 004).
//
// Pipeline:
//  1. ValidateProto - Proto field constraints
//  2. ResolveSlug - Generate slug from metadata.name if unset
//  3. LoadExisting - Load the existing channel by ID
//  4. ValidateChannelUpdate - spec.agent_ref and the provider arm are
//     immutable
//  5. BuildUpdateState - Merge spec, preserve id/slug/org, preserve status
//  6. NormalizeReferences - Make references absolute (fill org)
//  7. Persist - Save the channel
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (cloud requires can_edit on the channel).
func (c *AgentChannelController) Update(ctx context.Context, channel *agentchannelv1.AgentChannel) (*agentchannelv1.AgentChannel, error) {
	reqCtx := pipeline.NewRequestContext(ctx, channel)

	p := c.buildUpdatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *AgentChannelController) buildUpdatePipeline() *pipeline.Pipeline[*agentchannelv1.AgentChannel] {
	return pipeline.NewPipeline[*agentchannelv1.AgentChannel]("agent-channel-update").
		AddStep(steps.NewValidateProtoStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewResolveSlugStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewLoadExistingStep[*agentchannelv1.AgentChannel](c.store)).
		AddStep(&validateChannelUpdateStep{}).
		AddStep(steps.NewBuildUpdateStateStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewNormalizeReferencesStep[*agentchannelv1.AgentChannel]()).
		AddStep(steps.NewPersistStep[*agentchannelv1.AgentChannel](c.store)).
		Build()
}
