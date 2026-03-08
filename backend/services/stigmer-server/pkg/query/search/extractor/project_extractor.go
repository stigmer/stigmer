package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/project/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ProjectExtractor extracts searchable data from Project resources.
//
// Projects are declarative groupings of agents, skills, MCP servers, and
// workflows. The search summary uses spec.description.
type ProjectExtractor struct{}

var _ SearchableExtractor = (*ProjectExtractor)(nil)

func init() {
	Register(&ProjectExtractor{})
}

func (e *ProjectExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_project
}

func (e *ProjectExtractor) NewEmptyProto() proto.Message {
	return &projectv1.Project{}
}

func (e *ProjectExtractor) GetSearchSummary(resource proto.Message) string {
	project, ok := resource.(*projectv1.Project)
	if !ok || project.GetSpec() == nil {
		return ""
	}
	return project.GetSpec().GetDescription()
}

func (e *ProjectExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	project, ok := resource.(*projectv1.Project)
	if !ok {
		return nil
	}

	meta := project.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_project,
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

	if audit := project.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				result.CreatedAt = specAudit.GetCreatedAt()
			}
			if specAudit.GetUpdatedAt() != nil {
				result.UpdatedAt = specAudit.GetUpdatedAt()
			}
		}
	}

	if result.CreatedAt == nil {
		result.CreatedAt = &timestamppb.Timestamp{}
	}
	if result.UpdatedAt == nil {
		result.UpdatedAt = &timestamppb.Timestamp{}
	}

	return result
}

func (e *ProjectExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	project, ok := resource.(*projectv1.Project)
	if !ok {
		return nil
	}

	meta := project.GetMetadata()
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

	if audit := project.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
