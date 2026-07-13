package agentshare

import (
	"context"

	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves an agent share by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from AgentShareId.Value wrapper
//  3. LoadTarget - Load the share from the database
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (no multi-user auth).
func (c *AgentShareController) Get(ctx context.Context, shareId *agentsharev1.AgentShareId) (*agentsharev1.AgentShare, error) {
	reqCtx := pipeline.NewRequestContext(ctx, shareId)

	p := c.buildGetPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	target := reqCtx.Get(steps.TargetResourceKey)
	if target == nil {
		return nil, grpclib.InternalError(nil, "target agent share not found in context")
	}

	return target.(*agentsharev1.AgentShare), nil
}

func (c *AgentShareController) buildGetPipeline() *pipeline.Pipeline[*agentsharev1.AgentShareId] {
	return pipeline.NewPipeline[*agentsharev1.AgentShareId]("agent-share-get").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.AgentShareId]()).
		AddStep(steps.NewExtractResourceIdStep[*agentsharev1.AgentShareId]()).
		AddStep(steps.NewLoadTargetStep[*agentsharev1.AgentShareId, *agentsharev1.AgentShare](c.store)).
		Build()
}
