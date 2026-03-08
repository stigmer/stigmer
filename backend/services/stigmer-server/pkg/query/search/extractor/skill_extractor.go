package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// SkillExtractor extracts searchable data from Skill resources.
//
// Skills are knowledge documents (SKILL.md files) that provide domain-specific
// information to agents. The search summary uses the skill's description field
// from the spec, which is extracted from the SKILL.md YAML frontmatter.
type SkillExtractor struct{}

// Compile-time assertion that SkillExtractor implements SearchableExtractor.
var _ SearchableExtractor = (*SkillExtractor)(nil)

func init() {
	Register(&SkillExtractor{})
}

// Kind returns the resource kind this extractor handles.
func (e *SkillExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_skill
}

// NewEmptyProto returns a new zero-value Skill proto.
func (e *SkillExtractor) NewEmptyProto() proto.Message {
	return &skillv1.Skill{}
}

// GetSearchSummary extracts the display summary for search results.
// Returns spec.description.
func (e *SkillExtractor) GetSearchSummary(resource proto.Message) string {
	skill, ok := resource.(*skillv1.Skill)
	if !ok || skill.GetSpec() == nil {
		return ""
	}

	return skill.GetSpec().GetDescription()
}

// ToSearchResult converts the Skill to a SearchResult proto.
func (e *SkillExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	skill, ok := resource.(*skillv1.Skill)
	if !ok {
		return nil
	}

	meta := skill.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_skill,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Description:   e.GetSearchSummary(resource),
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
	}

	// Extract audit timestamps
	if audit := skill.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				result.CreatedAt = specAudit.GetCreatedAt()
			}
			if specAudit.GetUpdatedAt() != nil {
				result.UpdatedAt = specAudit.GetUpdatedAt()
			}
		}
	}

	// Default timestamps if not set
	if result.CreatedAt == nil {
		result.CreatedAt = &timestamppb.Timestamp{}
	}
	if result.UpdatedAt == nil {
		result.UpdatedAt = &timestamppb.Timestamp{}
	}

	return result
}

// GetSearchIndexEntry extracts fields for the FTS5 search index.
func (e *SkillExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	skill, ok := resource.(*skillv1.Skill)
	if !ok {
		return nil
	}

	meta := skill.GetMetadata()
	if meta == nil {
		return nil
	}

	entry := &store.SearchIndexEntry{
		Name:        meta.GetName(),
		Description: e.GetSearchSummary(resource),
		Tags:        JoinTags(meta.GetTags()),
		Org:         meta.GetOrg(),
		Visibility:  meta.GetVisibility().String(),
	}

	// Extract created_at timestamp as Unix seconds
	if audit := skill.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
