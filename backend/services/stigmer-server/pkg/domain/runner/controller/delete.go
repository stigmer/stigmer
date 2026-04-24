package runner

import (
	"context"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes a Runner by ID.
//
// Pipeline:
//  1. ValidateProto — validate proto field constraints (RunnerId wrapper)
//  2. ExtractResourceId — extract ID from RunnerId.Value wrapper
//  3. LoadExistingForDelete — load runner from database (stores in context for return)
//  4. DeleteResource — delete runner from database
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Authorization step (no multi-user auth)
//   - IAM policy cleanup (no FGA)
//   - Event publishing (no event system)
//
// The deleted runner is returned for audit trail purposes (gRPC convention).
func (c *RunnerController) Delete(ctx context.Context, runnerId *runnerv1.RunnerId) (*runnerv1.Runner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runnerId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deletedRunner := reqCtx.Get(steps.ExistingResourceKey)
	if deletedRunner == nil {
		return nil, grpclib.InternalError(nil, "deleted runner not found in context")
	}

	return deletedRunner.(*runnerv1.Runner), nil
}

func (c *RunnerController) buildDeletePipeline() *pipeline.Pipeline[*runnerv1.RunnerId] {
	return pipeline.NewPipeline[*runnerv1.RunnerId]("runner-delete").
		AddStep(steps.NewValidateProtoStep[*runnerv1.RunnerId]()).                                  // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*runnerv1.RunnerId]()).                              // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*runnerv1.RunnerId, *runnerv1.Runner](c.store)). // 3. Load runner
		AddStep(steps.NewDeleteResourceStep[*runnerv1.RunnerId](c.store)).                          // 4. Delete from database
		Build()
}
