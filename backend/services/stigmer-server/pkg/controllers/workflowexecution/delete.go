package workflowexecution

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Delete deletes a workflow execution by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (ApiResourceId wrapper)
// 2. ExtractResourceId - Extract ID from ApiResourceId.value wrapper
// 3. LoadExistingForDelete - Load execution from database (stores in context)
// 4. DeleteResource - Delete execution from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
// - Event publishing (no event system)
//
// The deleted execution is returned for audit trail purposes (gRPC convention).
func (c *WorkflowExecutionController) Delete(ctx context.Context, id *apiresource.ApiResourceId) (*workflowexecutionv1.WorkflowExecution, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, id)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted execution from context (set by LoadExistingForDelete step before deletion)
	deletedExecution := reqCtx.Get(steps.ExistingResourceKey)
	if deletedExecution == nil {
		return nil, grpclib.InternalError(nil, "deleted workflow execution not found in context")
	}

	return deletedExecution.(*workflowexecutionv1.WorkflowExecution), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
//
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteResourceStep: Generic delete by ID
func (c *WorkflowExecutionController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceId] {
	return pipeline.NewPipeline[*apiresource.ApiResourceId]("workflowexecution-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceId]()).                                                      // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*apiresource.ApiResourceId]()).                                                  // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceId, *workflowexecutionv1.WorkflowExecution](c.store)). // 3. Load execution
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceId](c.store)).                                              // 4. Delete from database
		Build()
}
