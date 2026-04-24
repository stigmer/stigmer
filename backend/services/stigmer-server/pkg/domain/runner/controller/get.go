package runner

import (
	"context"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a single Runner by ID.
//
// Pipeline:
//  1. ValidateProto — validate proto field constraints (RunnerId wrapper)
//  2. LoadTarget — extract ID from wrapper and load runner from repository
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
func (c *RunnerController) Get(ctx context.Context, runnerId *runnerv1.RunnerId) (*runnerv1.Runner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runnerId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(steps.TargetResourceKey).(*runnerv1.Runner), nil
}

func (c *RunnerController) buildGetPipeline() *pipeline.Pipeline[*runnerv1.RunnerId] {
	return pipeline.NewPipeline[*runnerv1.RunnerId]("runner-get").
		AddStep(steps.NewValidateProtoStep[*runnerv1.RunnerId]()).                       // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*runnerv1.RunnerId, *runnerv1.Runner](c.store)). // 2. Load by ID
		Build()
}
