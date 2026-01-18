package agentexecution

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Delete deletes an agent execution using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ExtractResourceId - Extract ID from ApiResourceId wrapper
// 3. LoadExisting - Load execution from repository (for audit trail)
// 4. Delete - Delete from database
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CleanupIamPolicies step (no IAM/FGA in OSS)
//
// Returns the deleted execution for audit trail (gRPC convention).
func (c *AgentExecutionController) Delete(ctx context.Context, executionId *apiresource.ApiResourceId) (*agentexecutionv1.AgentExecution, error) {
	reqCtx := pipeline.NewRequestContext(ctx, executionId)

	p := c.buildDeletePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Return the deleted resource from context (set by LoadExistingForDelete step)
	return reqCtx.Get(steps.ExistingResourceKey).(*agentexecutionv1.AgentExecution), nil
}

// buildDeletePipeline constructs the pipeline for agent execution deletion
func (c *AgentExecutionController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceId] {
	return pipeline.NewPipeline[*apiresource.ApiResourceId]("agent-execution-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceId]()).                                                  // 1. Validate input
		AddStep(steps.NewExtractResourceIdStep[*apiresource.ApiResourceId]()).                                              // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceId, *agentexecutionv1.AgentExecution](c.store)). // 3. Load existing
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceId](c.store)).                                          // 4. Delete from database
		Build()
}
