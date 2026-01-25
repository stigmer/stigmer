package skill

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Push uploads a skill artifact and creates or updates the skill resource.
//
// This operation:
// 1. Validates the request and artifact
// 2. Extracts SKILL.md from the ZIP (in memory, safely)
// 3. Calculates SHA256 hash (content-addressable identifier)
// 4. Checks if artifact already exists (deduplication)
// 5. Stores the artifact if new
// 6. Creates or updates the skill resource in BadgerDB
// 7. Archives previous version (if updating)
//
// Security:
// - Uses google/safearchive to prevent path traversal and symlink attacks
// - Validates ZIP size and compression ratios (prevents ZIP bombs)
// - Extracts SKILL.md in memory only (executables never touch disk)
// - Stores sealed ZIP with restricted permissions (0600)
//
// Content-Addressable Storage:
// - Same content = same hash = single storage copy (deduplication)
// - Artifacts are immutable once stored
// - Multiple skills/versions can reference the same artifact
func (c *SkillController) Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.PushSkillResponse, error) {
	// 1. Validate request
	if err := validatePushRequest(req); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid request: %v", err)
	}

	// 2. Normalize name to slug
	slug := generateSlug(req.Name)
	if slug == "" {
		return nil, status.Errorf(codes.InvalidArgument, "invalid skill name: %s", req.Name)
	}

	// 3. Extract SKILL.md and calculate hash (safely)
	extractResult, err := storage.ExtractSkillMd(req.Artifact)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to extract SKILL.md: %v", err)
	}

	// 4. Check if artifact already exists (deduplication)
	exists, err := c.artifactStorage.Exists(extractResult.Hash)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to check artifact existence: %v", err)
	}

	var storageKey string
	if exists {
		// Artifact already exists - reuse storage key (deduplication!)
		storageKey = c.artifactStorage.GetStorageKey(extractResult.Hash)
	} else {
		// New artifact - store it
		storageKey, err = c.artifactStorage.Store(extractResult.Hash, req.Artifact)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to store artifact: %v", err)
		}
	}

	// 5. Construct skill resource ID
	// Format: For organization scope: org/<org_id>/skill/<slug>
	//         For platform scope: platform/skill/<slug>
	var resourceID string
	if req.Scope == apiresource.ApiResourceOwnerScope_organization {
		if req.Org == "" {
			return nil, status.Errorf(codes.InvalidArgument, "org required for organization-scoped skills")
		}
		resourceID = fmt.Sprintf("org/%s/skill/%s", req.Org, slug)
	} else {
		resourceID = fmt.Sprintf("platform/skill/%s", slug)
	}

	// 6. Check if skill already exists
	existingSkill := &skillv1.Skill{}
	err = c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_skill, resourceID, existingSkill)
	
	var skill *skillv1.Skill
	now := timestamppb.Now()

	if err != nil {
		// Skill doesn't exist - create new
		skill = &skillv1.Skill{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Skill",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         resourceID,
				Name:       slug,
				Slug:       slug,
				OwnerScope: req.Scope,
				Org:        req.Org,
			},
			Spec: &skillv1.SkillSpec{
				SkillMd: extractResult.Content,
				Tag:     req.Tag, // Optional tag (empty = no tag)
			},
			Status: &skillv1.SkillStatus{
				VersionHash:        extractResult.Hash,
				ArtifactStorageKey: storageKey,
				State:              skillv1.SkillState_SKILL_STATE_READY,
				Audit: &apiresource.ApiResourceAudit{
					SpecAudit: &apiresource.ApiResourceAuditInfo{
						CreatedAt: now,
						UpdatedAt: now,
					},
					StatusAudit: &apiresource.ApiResourceAuditInfo{
						CreatedAt: now,
						UpdatedAt: now,
					},
				},
			},
		}
	} else {
		// Skill exists - update to new version
		// Archive current version before updating
		if err := c.archiveSkill(ctx, existingSkill); err != nil {
			// Log warning but don't fail - archival is best-effort
			// In production, you might want stricter handling
			fmt.Printf("Warning: failed to archive skill %s: %v\n", resourceID, err)
		}

		// Update skill with new version
		skill = existingSkill
		skill.Spec.SkillMd = extractResult.Content
		skill.Spec.Tag = req.Tag
		skill.Status.VersionHash = extractResult.Hash
		skill.Status.ArtifactStorageKey = storageKey
		skill.Status.State = skillv1.SkillState_SKILL_STATE_READY
		
		// Update timestamps
		skill.Status.Audit.SpecAudit.UpdatedAt = now
		skill.Status.Audit.StatusAudit.UpdatedAt = now
	}

	// 7. Save skill to BadgerDB
	if err := c.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_skill, resourceID, skill); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save skill: %v", err)
	}

	// 8. Return success response
	return &skillv1.PushSkillResponse{
		VersionHash:        extractResult.Hash,
		ArtifactStorageKey: storageKey,
		Tag:                req.Tag,
	}, nil
}

// validatePushRequest validates the PushSkillRequest.
func validatePushRequest(req *skillv1.PushSkillRequest) error {
	if req.Name == "" {
		return fmt.Errorf("name is required")
	}

	if req.Artifact == nil || len(req.Artifact) == 0 {
		return fmt.Errorf("artifact is required")
	}

	if req.Scope == apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified {
		return fmt.Errorf("scope is required")
	}

	return nil
}

// archiveSkill saves a snapshot of the current skill to the audit collection.
// This preserves the version history before updating to a new version.
//
// Audit Pattern:
// - Each update triggers archival of the current state
// - Archived records are immutable (never modified)
// - Query by tag returns latest version with that tag (sorted by timestamp)
// - Query by hash returns exact match
func (c *SkillController) archiveSkill(ctx context.Context, skill *skillv1.Skill) error {
	// Create audit key: skill_audit/<resource_id>/<timestamp>
	// This ensures each archived version has a unique key
	timestamp := time.Now().UnixNano()
	auditKey := fmt.Sprintf("skill_audit/%s/%d", skill.Metadata.Id, timestamp)

	// Save snapshot to audit collection
	if err := c.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_skill, auditKey, skill); err != nil {
		return fmt.Errorf("failed to archive skill: %w", err)
	}

	return nil
}

// generateSlug converts a name into a URL-friendly slug.
// This matches the implementation in pipeline/steps/slug.go
func generateSlug(name string) string {
	// 1. Convert to lowercase
	slug := strings.ToLower(name)

	// 2. Replace spaces with hyphens
	slug = strings.ReplaceAll(slug, " ", "-")

	// 3. Remove non-alphanumeric characters except hyphens
	reg := regexp.MustCompile("[^a-z0-9-]+")
	slug = reg.ReplaceAllString(slug, "")

	// 4. Collapse multiple consecutive hyphens
	reg = regexp.MustCompile("-+")
	slug = reg.ReplaceAllString(slug, "-")

	// 5. Trim leading and trailing hyphens
	slug = strings.Trim(slug, "-")

	return slug
}
