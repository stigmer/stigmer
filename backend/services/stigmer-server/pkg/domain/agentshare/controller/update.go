package agentshare

import (
	"context"

	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing agent share using the pipeline framework.
//
// The spec is replaced wholesale (declarative semantics): a manifest that
// omits audience resets the share to public, and one that omits
// environment_refs unbinds them — fails closed, matching every other
// resource. status is preserved verbatim from the existing share, which
// is the guarantee that keeps status.share_link_token immune to
// declarative clobber (rotateShareLink is its sole writer).
//
// Pipeline:
//  1. ValidateProto - Proto field constraints (incl. the org-audience
//     environment_refs CEL rule)
//  2. ResolveSlug - Generate slug from metadata.name if unset
//  3. LoadExisting - Load the existing share by ID
//  4. ValidateShareUpdate - spec.agent_ref is immutable
//  5. BuildUpdateState - Merge spec, preserve id/slug/org, preserve status
//  6. NormalizeReferences - Make environment_refs absolute (fill org)
//  7. Persist - Save the share
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (cloud requires can_edit on the share).
func (c *AgentShareController) Update(ctx context.Context, share *agentsharev1.AgentShare) (*agentsharev1.AgentShare, error) {
	reqCtx := pipeline.NewRequestContext(ctx, share)

	p := c.buildUpdatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *AgentShareController) buildUpdatePipeline() *pipeline.Pipeline[*agentsharev1.AgentShare] {
	return pipeline.NewPipeline[*agentsharev1.AgentShare]("agent-share-update").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.AgentShare]()).
		AddStep(steps.NewResolveSlugStep[*agentsharev1.AgentShare]()).
		AddStep(steps.NewLoadExistingStep[*agentsharev1.AgentShare](c.store)).
		AddStep(&validateShareUpdateStep{}).
		AddStep(steps.NewBuildUpdateStateStep[*agentsharev1.AgentShare]()).
		AddStep(steps.NewNormalizeReferencesStep[*agentsharev1.AgentShare]()).
		AddStep(steps.NewPersistStep[*agentsharev1.AgentShare](c.store)).
		Build()
}
