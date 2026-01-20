package executioncontext

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
)

// Create creates a new execution context using the pipeline framework
//
// ExecutionContext is an operator-only, platform-scoped resource that:
// - Contains ephemeral runtime configuration and secrets
// - Is created by the execution engine at execution start
// - Is deleted when execution completes
// - Is only accessible by platform operators
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ResolveSlug - Generate slug from metadata.name (must be before validation)
// 2. ValidateProto - Validate proto field constraints (including owner_scope restriction)
// 3. CheckDuplicate - Verify no duplicate exists by slug
// 4. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 5. Persist - Save execution context to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *ExecutionContextController) Create(ctx context.Context, executionContext *executioncontextv1.ExecutionContext) (*executioncontextv1.ExecutionContext, error) {
	reqCtx := pipeline.NewRequestContext(ctx, executionContext)
	reqCtx.SetNewState(executionContext)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for execution context creation
func (c *ExecutionContextController) buildCreatePipeline() *pipeline.Pipeline[*executioncontextv1.ExecutionContext] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*executioncontextv1.ExecutionContext]("execution-context-create").
		AddStep(steps.NewResolveSlugStep[*executioncontextv1.ExecutionContext]()).           // 1. Resolve slug (must be before validation)
		AddStep(steps.NewValidateProtoStep[*executioncontextv1.ExecutionContext]()).         // 2. Validate field constraints
		AddStep(steps.NewCheckDuplicateStep[*executioncontextv1.ExecutionContext](c.store)). // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*executioncontextv1.ExecutionContext]()).         // 4. Build new state
		AddStep(steps.NewPersistStep[*executioncontextv1.ExecutionContext](c.store)).        // 5. Persist
		Build()
}
