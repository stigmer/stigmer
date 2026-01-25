package skill

import (
	"context"
	"fmt"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes a skill by ID using the pipeline pattern.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (skill ID wrapper)
// 2. ExtractResourceId - Extract ID from SkillId.Value wrapper
// 3. LoadExistingForDelete - Load skill from database (stores in context)
// 4. DeleteSkillArchives - Delete version history archive records (best-effort)
// 5. DeleteResource - Delete skill from database
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
// Steps:
// - ValidateProtoStep: Generic proto validation
// - ExtractResourceIdStep: Generic ID extraction from wrapper types
// - LoadExistingForDeleteStep: Generic load by ID
// - DeleteSkillArchivesStep: Skill-specific - delete version history archives
// - DeleteResourceStep: Generic delete by ID
func (c *SkillController) buildDeletePipeline() *pipeline.Pipeline[*skillv1.SkillId] {
	return pipeline.NewPipeline[*skillv1.SkillId]("skill-delete").
		AddStep(steps.NewValidateProtoStep[*skillv1.SkillId]()).                                // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*skillv1.SkillId]()).                            // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*skillv1.SkillId, *skillv1.Skill](c.store)). // 3. Load skill
		AddStep(c.newDeleteSkillArchivesStep()).                                                // 4. Delete archive records
		AddStep(steps.NewDeleteResourceStep[*skillv1.SkillId](c.store)).                        // 5. Delete from database
		Build()
}

// DeleteSkillArchivesStep deletes all archive (audit) records for a skill
//
// This step cleans up the version history archives created by Push operations.
// Archive records are stored with keys in the format: skill_audit/<resource_id>/<timestamp>
//
// This step runs BEFORE the main skill deletion to ensure archives are cleaned up
// even if we want to maintain referential integrity in the future.
// Archive deletion is best-effort - failures are logged but don't stop the delete operation.
type DeleteSkillArchivesStep struct {
	store *badger.Store
}

func (c *SkillController) newDeleteSkillArchivesStep() *DeleteSkillArchivesStep {
	return &DeleteSkillArchivesStep{
		store: c.store,
	}
}

func (s *DeleteSkillArchivesStep) Name() string {
	return "DeleteSkillArchives"
}

func (s *DeleteSkillArchivesStep) Execute(ctx *pipeline.RequestContext[*skillv1.SkillId]) error {
	// Get resource ID from context (set by ExtractResourceIdStep)
	idVal := ctx.Get(steps.ResourceIdKey)
	if idVal == nil {
		return fmt.Errorf("resource id not found in context (ExtractResourceIdStep must run first)")
	}
	resourceId := idVal.(string)

	// Delete all archive records with prefix: skill_audit/<resource_id>/
	// This matches the key format used in ArchiveCurrentSkillStep
	archivePrefix := fmt.Sprintf("skill_audit/%s/", resourceId)

	deletedCount, err := s.store.DeleteResourcesByIdPrefix(ctx.Context(), apiresourcekind.ApiResourceKind_skill, archivePrefix)
	if err != nil {
		// Log warning but don't fail - archive cleanup is best-effort
		fmt.Printf("Warning: failed to delete skill archives for %s: %v\n", resourceId, err)
	} else if deletedCount > 0 {
		fmt.Printf("Deleted %d archive records for skill %s\n", deletedCount, resourceId)
	}

	return nil
}
