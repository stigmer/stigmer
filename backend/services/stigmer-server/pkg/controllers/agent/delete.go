package agent

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// Delete deletes an agent by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (agent ID wrapper)
// 2. ExtractResourceId - Extract ID from AgentId.Value wrapper
// 3. LoadExistingForDelete - Load agent from database (stores in context)
// 4. DeleteResource - Delete agent from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
// - Event publishing (no event system)
//
// The deleted agent is returned for audit trail purposes (gRPC convention).
func (c *AgentController) Delete(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, agentId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted agent from context (set by LoadExistingForDelete step before deletion)
	deletedAgent := reqCtx.Get(steps.ExistingResourceKey)
	if deletedAgent == nil {
		return nil, grpclib.InternalError(nil, "deleted agent not found in context")
	}

	return deletedAgent.(*agentv1.Agent), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
//
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteResourceStep: Generic delete by ID
func (c *AgentController) buildDeletePipeline() *pipeline.Pipeline[*agentv1.AgentId] {
	return pipeline.NewPipeline[*agentv1.AgentId]("agent-delete").
		AddStep(steps.NewValidateProtoStep[*agentv1.AgentId]()).                                // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*agentv1.AgentId]()).                            // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*agentv1.AgentId, *agentv1.Agent](c.store)). // 3. Load agent
		AddStep(steps.NewDeleteResourceStep[*agentv1.AgentId](c.store)).                        // 4. Delete from database
		Build()
}
