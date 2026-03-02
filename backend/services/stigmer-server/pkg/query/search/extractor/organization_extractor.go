package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// OrganizationExtractor extracts searchable data from Organization resources.
//
// Organizations are the top-level container for all Stigmer resources. The
// search summary uses the description field from the spec.
type OrganizationExtractor struct{}

var _ SearchableExtractor = (*OrganizationExtractor)(nil)

func init() {
	Register(&OrganizationExtractor{})
}

// Kind returns the resource kind this extractor handles.
func (e *OrganizationExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_organization
}

// GetSearchSummary extracts the display summary for search results.
// Returns spec.description.
func (e *OrganizationExtractor) GetSearchSummary(resource proto.Message) string {
	org, ok := resource.(*organizationv1.Organization)
	if !ok || org.GetSpec() == nil {
		return ""
	}

	return org.GetSpec().GetDescription()
}

// ToSearchResult converts the Organization to a SearchResult proto.
func (e *OrganizationExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	org, ok := resource.(*organizationv1.Organization)
	if !ok {
		return nil
	}

	meta := org.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_organization,
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

	if audit := org.GetStatus().GetAudit(); audit != nil {
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

// GetSearchIndexEntry extracts fields for the FTS5 search index.
func (e *OrganizationExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	org, ok := resource.(*organizationv1.Organization)
	if !ok {
		return nil
	}

	meta := org.GetMetadata()
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

	if audit := org.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
