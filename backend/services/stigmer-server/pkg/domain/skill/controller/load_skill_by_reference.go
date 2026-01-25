package skill

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// hashPattern matches a 64-character hex string (SHA256 hash)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// isHash returns true if the version string looks like a SHA256 hash
func isHash(version string) bool {
	return hashPattern.MatchString(version)
}

// LoadSkillByReferenceStep loads a skill by ApiResourceReference with version support
//
// This skill-specific step handles version resolution:
//   - If version is empty/"latest" → Load from main skill collection (current state)
//   - If version is a tag → Check main first, then query audit table for matching tag
//   - If version is a hash → Check main first, then query audit table for matching hash
//
// Version Resolution Logic:
//  1. Find skill by slug in main collection
//  2. If version is empty/"latest", return found skill
//  3. If version matches main skill's tag or hash, return it
//  4. Otherwise, query the audit table for the matching version using indexed lookups
//
// The audit records are stored in a dedicated resource_audit table with indexes
// on (kind, resource_id, version_hash) and (kind, resource_id, tag, archived_at DESC)
// for efficient lookups without full table scans.
//
// Usage:
//
//	pipeline.NewPipeline[*apiresource.ApiResourceReference]("skill-get-by-reference").
//	    AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
//	    AddStep(controller.newLoadSkillByReferenceStep()).
//	    Build()
type LoadSkillByReferenceStep struct {
	store store.Store
}

func (c *SkillController) newLoadSkillByReferenceStep() *LoadSkillByReferenceStep {
	return &LoadSkillByReferenceStep{
		store: c.store,
	}
}

func (s *LoadSkillByReferenceStep) Name() string {
	return "LoadSkillByReference"
}

func (s *LoadSkillByReferenceStep) Execute(ctx *pipeline.RequestContext[*apiresourcepb.ApiResourceReference]) error {
	ref := ctx.Input()

	// Validate reference
	if ref == nil {
		return grpclib.InvalidArgumentError("reference is required")
	}

	if ref.Slug == "" {
		return grpclib.InvalidArgumentError("slug is required in reference")
	}

	// Step 1: Find skill by slug in main collection
	mainSkill, found, err := s.findMainSkillBySlug(ctx.Context(), ref.Slug, ref.Org)
	if err != nil {
		return err
	}

	if !found {
		return grpclib.NotFoundError("skill", ref.Slug)
	}

	// Step 2: Determine which version to return
	version := strings.TrimSpace(ref.Version)

	// If version is empty or "latest", return the main skill
	if version == "" || version == "latest" {
		ctx.Set(steps.TargetResourceKey, mainSkill)
		return nil
	}

	// Step 3: Check if version matches main skill
	if s.skillMatchesVersion(mainSkill, version) {
		ctx.Set(steps.TargetResourceKey, mainSkill)
		return nil
	}

	// Step 4: Search audit records for the matching version
	auditSkill, found, err := s.findAuditSkillByVersion(ctx.Context(), mainSkill.Metadata.Id, version)
	if err != nil {
		return err
	}

	if !found {
		return grpclib.NotFoundError("skill version", fmt.Sprintf("%s:%s", ref.Slug, version))
	}

	ctx.Set(steps.TargetResourceKey, auditSkill)
	return nil
}

// findMainSkillBySlug finds a skill in the main collection by slug.
// With the new relational schema, the resources table only contains live resources
// (no audit records), so no filtering is needed.
func (s *LoadSkillByReferenceStep) findMainSkillBySlug(ctx context.Context, slug, org string) (*skillv1.Skill, bool, error) {
	// List all skills from main collection
	// Note: With the new schema, this only returns live resources (no audit records)
	resources, err := s.store.ListResources(ctx, apiresourcekind.ApiResourceKind_skill)
	if err != nil {
		return nil, false, grpclib.InternalError(err, "failed to list skills")
	}

	for _, data := range resources {
		var skill skillv1.Skill
		if err := proto.Unmarshal(data, &skill); err != nil {
			continue // Skip invalid entries
		}

		if skill.Metadata == nil {
			continue
		}

		// Match by slug
		if skill.Metadata.Slug == slug {
			// Additional org filter check (if org provided)
			if org != "" && skill.Metadata.Org != org {
				continue
			}
			return &skill, true, nil
		}
	}

	return nil, false, nil
}

// skillMatchesVersion checks if the skill matches the requested version
// Version can be a tag name or a SHA256 hash
func (s *LoadSkillByReferenceStep) skillMatchesVersion(skill *skillv1.Skill, version string) bool {
	if skill.Status == nil {
		return false
	}

	// Check if version is a hash
	if isHash(version) {
		return skill.Status.VersionHash == version
	}

	// Otherwise, treat as tag
	if skill.Spec != nil && skill.Spec.Tag == version {
		return true
	}

	return false
}

// findAuditSkillByVersion queries the audit table for a skill with matching version.
// Uses indexed lookups (GetAuditByHash or GetAuditByTag) instead of full table scans.
//
// Query strategy:
//   - If version is a hash: Use GetAuditByHash for O(log n) indexed lookup
//   - If version is a tag: Use GetAuditByTag which returns most recent by archived_at
func (s *LoadSkillByReferenceStep) findAuditSkillByVersion(ctx context.Context, skillID, version string) (*skillv1.Skill, bool, error) {
	var skill skillv1.Skill

	if isHash(version) {
		// Version is a hash - use indexed hash lookup
		err := s.store.GetAuditByHash(ctx, apiresourcekind.ApiResourceKind_skill, skillID, version, &skill)
		if err != nil {
			if errors.Is(err, store.ErrAuditNotFound) {
				return nil, false, nil
			}
			return nil, false, grpclib.InternalError(err, "failed to query audit by hash")
		}
		return &skill, true, nil
	}

	// Version is a tag - use indexed tag lookup (returns most recent)
	err := s.store.GetAuditByTag(ctx, apiresourcekind.ApiResourceKind_skill, skillID, version, &skill)
	if err != nil {
		if errors.Is(err, store.ErrAuditNotFound) {
			return nil, false, nil
		}
		return nil, false, grpclib.InternalError(err, "failed to query audit by tag")
	}
	return &skill, true, nil
}
