package agentinstance

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
)

// Delete deletes an agent instance by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (agent instance ID wrapper)
// 2. ExtractResourceId - Extract ID from AgentInstanceId.Value wrapper
// 3. LoadExistingForDelete - Load agent instance from database (stores in context)
// 4. DeleteResource - Delete agent instance from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
// - Event publishing (no event system)
//
// The deleted agent instance is returned for audit trail purposes (gRPC convention).
func (c *AgentInstanceController) Delete(ctx context.Context, instanceId *agentinstancev1.AgentInstanceId) (*agentinstancev1.AgentInstance, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, instanceId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted agent instance from context (set by LoadExistingForDelete step before deletion)
	deletedInstance := reqCtx.Get(steps.ExistingResourceKey)
	if deletedInstance == nil {
		return nil, grpclib.InternalError(nil, "deleted agent instance not found in context")
	}

	return deletedInstance.(*agentinstancev1.AgentInstance), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
//
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteResourceStep: Generic delete by ID
func (c *AgentInstanceController) buildDeletePipeline() *pipeline.Pipeline[*agentinstancev1.AgentInstanceId] {
	return pipeline.NewPipeline[*agentinstancev1.AgentInstanceId]("agent-instance-delete").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.AgentInstanceId]()).                                                // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*agentinstancev1.AgentInstanceId]()).                                            // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*agentinstancev1.AgentInstanceId, *agentinstancev1.AgentInstance](c.store)). // 3. Load instance
		AddStep(steps.NewDeleteResourceStep[*agentinstancev1.AgentInstanceId](c.store)).                                        // 4. Delete from database
		Build()
}
