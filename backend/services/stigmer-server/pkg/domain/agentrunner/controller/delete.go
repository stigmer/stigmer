package agentrunner

import (
	"context"

	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes an AgentRunner by ID.
//
// Pipeline:
//  1. ValidateProto — validate proto field constraints (AgentRunnerId wrapper)
//  2. ExtractResourceId — extract ID from AgentRunnerId.Value wrapper
//  3. LoadExistingForDelete — load runner from database (stores in context for return)
//  4. DeleteResource — delete runner from database
//
// Compared to Stigmer Cloud, OSS excludes:
//   - Authorization step (no multi-user auth)
//   - IAM policy cleanup (no FGA)
//   - Event publishing (no event system)
//
// The deleted runner is returned for audit trail purposes (gRPC convention).
func (c *AgentRunnerController) Delete(ctx context.Context, runnerId *agentrunnerv1.AgentRunnerId) (*agentrunnerv1.AgentRunner, error) {
	reqCtx := pipeline.NewRequestContext(ctx, runnerId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deletedRunner := reqCtx.Get(steps.ExistingResourceKey)
	if deletedRunner == nil {
		return nil, grpclib.InternalError(nil, "deleted agent runner not found in context")
	}

	return deletedRunner.(*agentrunnerv1.AgentRunner), nil
}

func (c *AgentRunnerController) buildDeletePipeline() *pipeline.Pipeline[*agentrunnerv1.AgentRunnerId] {
	return pipeline.NewPipeline[*agentrunnerv1.AgentRunnerId]("agent-runner-delete").
		AddStep(steps.NewValidateProtoStep[*agentrunnerv1.AgentRunnerId]()).                                           // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*agentrunnerv1.AgentRunnerId]()).                                       // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*agentrunnerv1.AgentRunnerId, *agentrunnerv1.AgentRunner](c.store)). // 3. Load runner
		AddStep(steps.NewDeleteResourceStep[*agentrunnerv1.AgentRunnerId](c.store)).                                   // 4. Delete from database
		Build()
}
