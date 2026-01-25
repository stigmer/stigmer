package skill

import (
	"context"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves a skill by ApiResourceReference with version support
//
// This implements the GetByReference operation pattern with skill-specific version resolution:
// 1. ValidateProto - Validate input ApiResourceReference
// 2. LoadSkillByReference - Load skill by slug with version resolution
//
// Version Resolution (via LoadSkillByReferenceStep):
// - If version is empty/"latest" → Load from main skill collection (current state)
// - If version is a tag → Check main first, then query skill_audit for matching tag
// - If version is a hash → Check main first, then query skill_audit for matching hash
//
// The version field in ApiResourceReference supports three formats:
// - Empty or "latest": Returns the current/latest version
// - Tag name (e.g., "stable", "v1.0"): Returns version with matching tag
// - SHA256 hash (64 hex chars): Returns exact version with matching hash
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on ApiResourceReference
// - LoadSkillByReference: Skill-specific lookup with version resolution
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// Reference Lookup Logic:
// - If ref.org is provided: queries skills in that org with matching slug
// - If ref.org is empty: queries platform-scoped skills with matching slug
// - Slug is matched against metadata.slug (slug is normalized name)
// - Version is resolved against main collection first, then audit records
//
// The loaded skill is stored in context with key "targetResource" and
// returned by the handler.
func (c *SkillController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*skillv1.Skill, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded skill from context
	skill := reqCtx.Get(steps.TargetResourceKey).(*skillv1.Skill)
	return skill, nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations
//
// This pipeline uses a skill-specific LoadSkillByReferenceStep that handles
// version resolution (tag/hash lookups in both main and audit collections).
func (c *SkillController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("skill-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()). // 1. Validate input
		AddStep(c.newLoadSkillByReferenceStep()).                                  // 2. Load by slug with version resolution
		Build()
}
