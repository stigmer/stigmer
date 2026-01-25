package skill

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
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
//   - If version is a tag → Check main first, then query skill_audit for matching tag
//   - If version is a hash → Check main first, then query skill_audit for matching hash
//
// Audit Key Format: skill/skill_audit/<resource_id>/<timestamp>
// The audit records are stored using the skill kind with a prefixed key.
//
// Version Resolution Logic:
//  1. Find skill by slug in main collection
//  2. If version is empty/"latest", return found skill
//  3. If version matches main skill's tag or hash, return it
//  4. Otherwise, scan audit records for the skill and find matching version
//  5. Return the most recent audit record matching the version (sorted by timestamp)
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

// findMainSkillBySlug finds a skill in the main collection by slug
func (s *LoadSkillByReferenceStep) findMainSkillBySlug(ctx context.Context, slug, org string) (*skillv1.Skill, bool, error) {
	// List all skills from main collection
	resources, err := s.store.ListResources(ctx, apiresourcekind.ApiResourceKind_skill)
	if err != nil {
		return nil, false, grpclib.InternalError(err, "failed to list skills")
	}

	for _, data := range resources {
		var skill skillv1.Skill
		if err := proto.Unmarshal(data, &skill); err != nil {
			continue // Skip invalid entries
		}

		// Skip audit records (they have "skill_audit/" prefix in their ID)
		if strings.HasPrefix(skill.Metadata.Id, "skill_audit/") {
			continue
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

// auditRecord holds an audit skill and its timestamp for sorting
type auditRecord struct {
	skill     *skillv1.Skill
	timestamp int64 // Extracted from key
}

// findAuditSkillByVersion searches audit records for a skill with matching version
// Returns the most recent audit record matching the version (by timestamp in key)
func (s *LoadSkillByReferenceStep) findAuditSkillByVersion(ctx context.Context, skillID, version string) (*skillv1.Skill, bool, error) {
	// List all skills (includes audit records)
	resources, err := s.store.ListResources(ctx, apiresourcekind.ApiResourceKind_skill)
	if err != nil {
		return nil, false, grpclib.InternalError(err, "failed to list skills")
	}

	// Collect matching audit records
	var matches []auditRecord

	// Audit key format: skill_audit/<resource_id>/<timestamp>
	auditPrefix := fmt.Sprintf("skill_audit/%s/", skillID)

	for _, data := range resources {
		var skill skillv1.Skill
		if err := proto.Unmarshal(data, &skill); err != nil {
			continue
		}

		// Only process audit records for this skill
		if skill.Metadata == nil || !strings.HasPrefix(skill.Metadata.Id, auditPrefix) {
			continue
		}

		// Check if this audit record matches the version
		if !s.skillMatchesVersion(&skill, version) {
			continue
		}

		// Extract timestamp from key: skill_audit/<resource_id>/<timestamp>
		parts := strings.Split(skill.Metadata.Id, "/")
		var timestamp int64 = 0
		if len(parts) >= 3 {
			fmt.Sscanf(parts[2], "%d", &timestamp)
		}

		matches = append(matches, auditRecord{
			skill:     proto.Clone(&skill).(*skillv1.Skill),
			timestamp: timestamp,
		})
	}

	if len(matches) == 0 {
		return nil, false, nil
	}

	// Sort by timestamp descending (most recent first)
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].timestamp > matches[j].timestamp
	})

	// Return the most recent match
	return matches[0].skill, true, nil
}
