package executioncontext

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	executioncontextv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// Delete deletes an execution context by ID using the pipeline pattern.
//
// ExecutionContext deletion is typically triggered by the execution engine when:
// - Workflow execution completes
// - Agent execution completes
// - Execution fails and cleanup is required
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (API resource delete input)
// 2. ExtractResourceId - Extract ID from ApiResourceDeleteInput
// 3. LoadExistingForDelete - Load execution context from database (stores in context)
// 4. DeleteResource - Delete execution context from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
// - Event publishing (no event system)
//
// The deleted execution context is returned for audit trail purposes (gRPC convention).
func (c *ExecutionContextController) Delete(ctx context.Context, deleteInput *apiresource.ApiResourceDeleteInput) (*executioncontextv1.ExecutionContext, error) {
	// Create request context with the delete input
	reqCtx := pipeline.NewRequestContext(ctx, deleteInput)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted execution context from context (set by LoadExistingForDelete step before deletion)
	deletedExecutionContext := reqCtx.Get(steps.ExistingResourceKey)
	if deletedExecutionContext == nil {
		return nil, grpclib.InternalError(nil, "deleted execution context not found in context")
	}

	return deletedExecutionContext.(*executioncontextv1.ExecutionContext), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
//
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from delete input
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteResourceStep: Generic delete by ID
func (c *ExecutionContextController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("execution-context-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).                                         // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*apiresource.ApiResourceDeleteInput]()).                                     // 2. Extract ID from delete input
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *executioncontextv1.ExecutionContext](c.store)). // 3. Load execution context
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).                                 // 4. Delete from database
		Build()
}
