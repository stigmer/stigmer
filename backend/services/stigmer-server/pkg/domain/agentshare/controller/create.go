package agentshare

import (
	"context"

	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Create creates a new agent share using the pipeline framework.
//
// Pipeline:
//  1. ValidateProto - Proto field constraints (incl. the message-level CEL
//     rule refusing environment_refs on org-audience shares)
//  2. ResolveShareDefaults - Require org, normalize agent_ref, load the
//     referenced agent, default slug from it; for cross-org shares,
//     enforce the decision 013 contract (public agent, public audience,
//     public dependencies)
//  3. ResolveSlug - Generate slug from metadata.name (skipped when the
//     defaults step already set it)
//  4. CheckDuplicate - Org+slug uniqueness; with the agent-slug default
//     this structurally caps shares at one canonical link per agent per org
//  5. BuildNewState - Set ID (ash_ prefix), clear status, audit fields
//  6. StampAgentPin - Write status.agent_id (the rebind guard) from the
//     agent loaded in step 2; after BuildNewState so the wipe of
//     client-provided status cannot erase it
//  7. NormalizeReferences - Make environment_refs absolute (fill org)
//  8. Persist - Save the share
//
// No search-index step: agent_share is not_search_indexed by design — a
// share is channel configuration reached through its agent, not a library
// artifact.
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
// requires can_edit on the referenced agent) and FGA tuple creation.
func (c *AgentShareController) Create(ctx context.Context, share *agentsharev1.AgentShare) (*agentsharev1.AgentShare, error) {
	reqCtx := pipeline.NewRequestContext(ctx, share)

	p := c.buildCreatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *AgentShareController) buildCreatePipeline() *pipeline.Pipeline[*agentsharev1.AgentShare] {
	return pipeline.NewPipeline[*agentsharev1.AgentShare]("agent-share-create").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.AgentShare]()).
		AddStep(&resolveShareDefaultsStep{store: c.store}).
		AddStep(steps.NewResolveSlugStep[*agentsharev1.AgentShare]()).
		AddStep(steps.NewCheckDuplicateStep[*agentsharev1.AgentShare](c.store)).
		AddStep(steps.NewBuildNewStateStep[*agentsharev1.AgentShare]()).
		AddStep(&stampAgentPinStep{}).
		AddStep(steps.NewNormalizeReferencesStep[*agentsharev1.AgentShare]()).
		AddStep(steps.NewPersistStep[*agentsharev1.AgentShare](c.store)).
		Build()
}
