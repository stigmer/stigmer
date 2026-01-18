package skill

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	skillv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/skill/v1"
)

// Delete deletes a skill by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (skill ID wrapper)
// 2. ExtractResourceId - Extract ID from SkillId.Value wrapper
// 3. LoadExistingForDelete - Load skill from database (stores in context)
// 4. DeleteResource - Delete skill from database
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization step (no multi-user auth)
// - IAM policy cleanup (no IAM system)
// - Event publishing (no event system)
//
// The deleted skill is returned for audit trail purposes (gRPC convention).
func (c *SkillController) Delete(ctx context.Context, skillId *skillv1.SkillId) (*skillv1.Skill, error) {
	// Create request context with the ID wrapper
	reqCtx := pipeline.NewRequestContext(ctx, skillId)

	// Build and execute pipeline
	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get deleted skill from context (set by LoadExistingForDelete step before deletion)
	deletedSkill := reqCtx.Get(steps.ExistingResourceKey)
	if deletedSkill == nil {
		return nil, grpclib.InternalError(nil, "deleted skill not found in context")
	}

	return deletedSkill.(*skillv1.Skill), nil
}

// buildDeletePipeline constructs the pipeline for delete operations
//
// All steps are generic and reusable across all API resources:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteResourceStep: Generic delete by ID
func (c *SkillController) buildDeletePipeline() *pipeline.Pipeline[*skillv1.SkillId] {
	return pipeline.NewPipeline[*skillv1.SkillId]("skill-delete").
		AddStep(steps.NewValidateProtoStep[*skillv1.SkillId]()).                                // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*skillv1.SkillId]()).                            // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*skillv1.SkillId, *skillv1.Skill](c.store)). // 3. Load skill
		AddStep(steps.NewDeleteResourceStep[*skillv1.SkillId](c.store)).                        // 4. Delete from database
		Build()
}
