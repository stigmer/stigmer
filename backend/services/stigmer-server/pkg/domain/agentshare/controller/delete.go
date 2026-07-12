package agentshare

import (
	"context"

	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes an agent share by ID using the pipeline pattern.
//
// Delete is the channel's full teardown: the hosted link stops resolving
// and the share's configuration (origins, messages, credentials, link
// token) is gone. Disabling (update with enabled=false) is the
// config-preserving pause. The referenced agent is untouched.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from AgentShareId.Value wrapper
//  3. LoadExistingForDelete - Load the share (stored in context for return)
//  4. DeleteResource - Delete the share from the database
//
// No search-index cleanup: agent_share is not_search_indexed.
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
//
// The deleted share is returned for audit trail purposes (gRPC convention).
func (c *AgentShareController) Delete(ctx context.Context, shareId *agentsharev1.AgentShareId) (*agentsharev1.AgentShare, error) {
	reqCtx := pipeline.NewRequestContext(ctx, shareId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deleted := reqCtx.Get(steps.ExistingResourceKey)
	if deleted == nil {
		return nil, grpclib.InternalError(nil, "deleted agent share not found in context")
	}

	return deleted.(*agentsharev1.AgentShare), nil
}

func (c *AgentShareController) buildDeletePipeline() *pipeline.Pipeline[*agentsharev1.AgentShareId] {
	return pipeline.NewPipeline[*agentsharev1.AgentShareId]("agent-share-delete").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.AgentShareId]()).
		AddStep(steps.NewExtractResourceIdStep[*agentsharev1.AgentShareId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*agentsharev1.AgentShareId, *agentsharev1.AgentShare](c.store)).
		AddStep(steps.NewDeleteResourceStep[*agentsharev1.AgentShareId](c.store)).
		Build()
}
