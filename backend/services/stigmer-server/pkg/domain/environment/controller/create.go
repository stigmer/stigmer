package environment

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
)

// Create creates a new environment using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateFieldConstraints - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
// 3. CheckDuplicate - Verify no duplicate exists
// 4. BuildNewState - Generate ID, clear status, set audit fields (timestamps, actors, event)
// 5. Persist - Save environment to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - CreateIamPolicies step (no IAM/FGA in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *EnvironmentController) Create(ctx context.Context, environment *environmentv1.Environment) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, environment)
	reqCtx.SetNewState(environment)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for environment creation
func (c *EnvironmentController) buildCreatePipeline() *pipeline.Pipeline[*environmentv1.Environment] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*environmentv1.Environment]("environment-create").
		AddStep(steps.NewValidateProtoStep[*environmentv1.Environment]()).         // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*environmentv1.Environment]()).           // 2. Resolve slug
		AddStep(steps.NewCheckDuplicateStep[*environmentv1.Environment](c.store)). // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*environmentv1.Environment]()).         // 4. Build new state
		AddStep(steps.NewPersistStep[*environmentv1.Environment](c.store)).        // 5. Persist environment
		Build()
}
