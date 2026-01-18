package agent

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

// Get retrieves an agent by ID using the pipeline framework
//
// This implements the standard Get operation pattern:
// 1. ValidateProto - Validate input AgentId (ensures value is not empty)
// 2. LoadTarget - Load agent from repository by ID
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on AgentId
// - LoadTarget: Loads agent from BadgerDB by ID, returns NotFound if missing
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - ExtractResourceId step (not needed - ID is already in AgentId.value)
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// The loaded agent is stored in context with key "targetResource" and
// returned by the handler.
func (c *AgentController) Get(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, agentId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded agent from context
	agent := reqCtx.Get(steps.TargetResourceKey).(*agentv1.Agent)
	return agent, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *AgentController) buildGetPipeline() *pipeline.Pipeline[*agentv1.AgentId] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*agentv1.AgentId]("agent-get").
		AddStep(steps.NewValidateProtoStep[*agentv1.AgentId]()).                     // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*agentv1.AgentId, *agentv1.Agent](c.store)). // 2. Load by ID
		Build()
}
