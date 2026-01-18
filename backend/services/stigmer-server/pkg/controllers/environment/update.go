package environment

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	environmentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/environment/v1"
)

// Update updates an existing environment using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name (for fallback lookup)
// 3. LoadExisting - Load existing environment from repository by ID
// 4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 5. Persist - Save updated environment to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *EnvironmentController) Update(ctx context.Context, environment *environmentv1.Environment) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, environment)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for environment update
func (c *EnvironmentController) buildUpdatePipeline() *pipeline.Pipeline[*environmentv1.Environment] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*environmentv1.Environment]("environment-update").
		AddStep(steps.NewValidateProtoStep[*environmentv1.Environment]()).         // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*environmentv1.Environment]()).           // 2. Resolve slug (for fallback lookup)
		AddStep(steps.NewLoadExistingStep[*environmentv1.Environment](c.store)).   // 3. Load existing environment
		AddStep(steps.NewBuildUpdateStateStep[*environmentv1.Environment]()).      // 4. Build updated state
		AddStep(steps.NewPersistStep[*environmentv1.Environment](c.store)).        // 5. Persist environment
		Build()
}
