package agentrunner

import (
	"context"

	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a single AgentRunner by ID.
//
// Pipeline:
//  1. ValidateProto — validate proto field constraints (AgentRunnerId wrapper)
//  2. LoadTarget — extract ID from wrapper and load runner from repository
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
func (c *AgentRunnerController) Get(ctx context.Context, runnerId *agentrunnerv1.AgentRunnerId) (*agentrunnerv1.AgentRunner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runnerId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(steps.TargetResourceKey).(*agentrunnerv1.AgentRunner), nil
}

func (c *AgentRunnerController) buildGetPipeline() *pipeline.Pipeline[*agentrunnerv1.AgentRunnerId] {
	return pipeline.NewPipeline[*agentrunnerv1.AgentRunnerId]("agent-runner-get").
		AddStep(steps.NewValidateProtoStep[*agentrunnerv1.AgentRunnerId]()).                                         // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*agentrunnerv1.AgentRunnerId, *agentrunnerv1.AgentRunner](c.store)). // 2. Load by ID
		Build()
}
