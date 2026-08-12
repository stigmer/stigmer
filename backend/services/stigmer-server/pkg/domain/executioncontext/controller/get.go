package executioncontext

import (
	"context"

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves an execution context by ID using the pipeline framework
//
// This operation is typically used to:
// - Inspect an execution's runtime configuration (values redacted)
// - Verify execution context exists before proceeding
//
// This implements the standard Get operation pattern:
// 1. ValidateProto - Validate input ExecutionContextId (ensures value is not empty)
// 2. LoadTarget - Load execution context from repository by ID
//
// Secret values are redacted in the response (oss#535, the cloud contract):
// the runner's secret-delivery path is getByExecutionId under a scope-bound
// runner token, never this RPC.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - ExtractResourceId step (not needed - ID is already in ExecutionContextId.value)
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// The loaded execution context is stored in context with key "targetResource" and
// returned by the handler.
func (c *ExecutionContextController) Get(ctx context.Context, executionContextId *executioncontextv1.ExecutionContextId) (*executioncontextv1.ExecutionContext, error) {
	reqCtx := pipeline.NewRequestContext(ctx, executionContextId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded execution context from context. Redaction mutates the
	// fresh store unmarshal, never the stored row.
	executionContext := reqCtx.Get(steps.TargetResourceKey).(*executioncontextv1.ExecutionContext)
	RedactExecutionContextSecrets(executionContext)
	return executionContext, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *ExecutionContextController) buildGetPipeline() *pipeline.Pipeline[*executioncontextv1.ExecutionContextId] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*executioncontextv1.ExecutionContextId]("execution-context-get").
		AddStep(steps.NewValidateProtoStep[*executioncontextv1.ExecutionContextId]()).                                           // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*executioncontextv1.ExecutionContextId, *executioncontextv1.ExecutionContext](c.store)). // 2. Load by ID
		Build()
}
