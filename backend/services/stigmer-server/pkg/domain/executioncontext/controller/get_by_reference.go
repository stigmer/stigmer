package executioncontext

import (
	"context"

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves an execution context by ApiResourceReference (slug-based lookup).
//
// This operation:
// - Loads execution context by slug (platform-scoped lookup)
// - Returns the execution context to the execution engine
//
// ExecutionContext resources are platform-scoped (owner_scope=unspecified).
// The reference lookup uses slug only (no org/env).
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate input reference
// 2. LoadByReference - Load execution context by slug (platform-scoped)
//
// Secret values are redacted in the response (oss#535, the cloud contract) —
// same as Get.
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// The loaded execution context is stored in context with key "targetResource" and
// returned by the handler.
func (c *ExecutionContextController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*executioncontextv1.ExecutionContext, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded execution context from context. Redaction mutates the
	// fresh store unmarshal, never the stored row.
	executionContext := reqCtx.Get(steps.TargetResourceKey).(*executioncontextv1.ExecutionContext)
	RedactExecutionContextSecrets(executionContext)
	return executionContext, nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *ExecutionContextController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("execution-context-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).             // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*executioncontextv1.ExecutionContext](c.store)). // 2. Load by reference
		Build()
}
