package executioncontext

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
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
// 2. LoadExistingForDelete - Load execution context from database (stores in context)
// 3. DeleteResource - Delete execution context from database
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

	// Manually extract and store resource ID since ApiResourceDeleteInput uses
	// ResourceId field instead of Value field (which ExtractResourceIdStep expects)
	reqCtx.Set(steps.ResourceIdKey, deleteInput.ResourceId)

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
// Note: ExtractResourceIdStep is NOT used here because ApiResourceDeleteInput
// has ResourceId field (not Value), so we manually extract it in Delete method
func (c *ExecutionContextController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("execution-context-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).                                                // 1. Validate field constraints
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *executioncontextv1.ExecutionContext](c.store)). // 2. Load execution context
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).                                        // 3. Delete from database
		Build()
}
