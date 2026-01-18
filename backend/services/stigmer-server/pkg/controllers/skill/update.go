package skill

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	skillv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/skill/v1"
)

// Update updates an existing skill using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name (for fallback lookup)
// 3. LoadExisting - Load existing skill from repository by ID
// 4. BuildUpdateState - Merge spec, preserve IDs, update timestamps, clear computed fields
// 5. Persist - Save updated skill to repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - Publish step (no event publishing in OSS)
// - TransformResponse step (no response transformations in OSS)
func (c *SkillController) Update(ctx context.Context, skill *skillv1.Skill) (*skillv1.Skill, error) {
	reqCtx := pipeline.NewRequestContext(ctx, skill)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for skill update
func (c *SkillController) buildUpdatePipeline() *pipeline.Pipeline[*skillv1.Skill] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*skillv1.Skill]("skill-update").
		AddStep(steps.NewValidateProtoStep[*skillv1.Skill]()).      // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*skillv1.Skill]()).        // 2. Resolve slug (for fallback lookup)
		AddStep(steps.NewLoadExistingStep[*skillv1.Skill](c.store)). // 3. Load existing skill
		AddStep(steps.NewBuildUpdateStateStep[*skillv1.Skill]()).   // 4. Build updated state
		AddStep(steps.NewPersistStep[*skillv1.Skill](c.store)).     // 5. Persist skill
		Build()
}
