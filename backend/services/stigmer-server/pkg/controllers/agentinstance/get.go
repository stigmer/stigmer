package agentinstance

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentinstance/v1"
)

// Get retrieves an agent instance by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (agent instance ID wrapper)
// 2. ExtractResourceId - Extract ID from AgentInstanceId.Value wrapper
// 3. LoadTarget - Load agent instance from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - TransformResponse step (no response transformations)
func (c *AgentInstanceController) Get(ctx context.Context, instanceId *agentinstancev1.AgentInstanceId) (*agentinstancev1.AgentInstance, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, instanceId)

	// Build and execute pipeline
	p := c.buildGetPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get loaded agent instance from context (set by LoadTarget step)
	targetInstance := reqCtx.Get(steps.TargetResourceKey)
	if targetInstance == nil {
		return nil, grpclib.InternalError(nil, "target agent instance not found in context")
	}

	return targetInstance.(*agentinstancev1.AgentInstance), nil
}

// buildGetPipeline constructs the pipeline for get operations
//
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadTargetStep: Generic load by ID
func (c *AgentInstanceController) buildGetPipeline() *pipeline.Pipeline[*agentinstancev1.AgentInstanceId] {
	return pipeline.NewPipeline[*agentinstancev1.AgentInstanceId]("agent-instance-get").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.AgentInstanceId]()).                                     // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*agentinstancev1.AgentInstanceId]()).                                 // 2. Extract ID from wrapper
		AddStep(steps.NewLoadTargetStep[*agentinstancev1.AgentInstanceId, *agentinstancev1.AgentInstance](c.store)). // 3. Load from database
		Build()
}
