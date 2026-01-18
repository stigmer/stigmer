package skill

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	skillv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/skill/v1"
)

// Get retrieves a skill by ID using the pipeline framework
//
// This implements the standard Get operation pattern:
// 1. ValidateProto - Validate input SkillId (ensures value is not empty)
// 2. LoadTarget - Load skill from repository by ID
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on SkillId
// - LoadTarget: Loads skill from BadgerDB by ID, returns NotFound if missing
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - ExtractResourceId step (not needed - ID is already in SkillId.value)
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// The loaded skill is stored in context with key "targetResource" and
// returned by the handler.
func (c *SkillController) Get(ctx context.Context, skillId *skillv1.SkillId) (*skillv1.Skill, error) {
	reqCtx := pipeline.NewRequestContext(ctx, skillId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded skill from context
	skill := reqCtx.Get(steps.TargetResourceKey).(*skillv1.Skill)
	return skill, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *SkillController) buildGetPipeline() *pipeline.Pipeline[*skillv1.SkillId] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*skillv1.SkillId]("skill-get").
		AddStep(steps.NewValidateProtoStep[*skillv1.SkillId]()).                     // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*skillv1.SkillId, *skillv1.Skill](c.store)). // 2. Load by ID
		Build()
}
