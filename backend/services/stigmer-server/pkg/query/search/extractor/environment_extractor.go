package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// EnvironmentExtractor extracts searchable data from Environment resources.
//
// Environments provide variable bindings and configuration context for agent
// executions. The summary uses spec.description.
type EnvironmentExtractor struct{}

var _ SearchableExtractor = (*EnvironmentExtractor)(nil)

func init() {
	Register(&EnvironmentExtractor{})
}

func (e *EnvironmentExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_environment
}

func (e *EnvironmentExtractor) NewEmptyProto() proto.Message {
	return &environmentv1.Environment{}
}

func (e *EnvironmentExtractor) GetSearchSummary(resource proto.Message) string {
	env, ok := resource.(*environmentv1.Environment)
	if !ok || env.GetSpec() == nil {
		return ""
	}
	return env.GetSpec().GetDescription()
}

func (e *EnvironmentExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	env, ok := resource.(*environmentv1.Environment)
	if !ok {
		return nil
	}

	meta := env.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_environment,
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

	if audit := env.GetStatus().GetAudit(); audit != nil {
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

func (e *EnvironmentExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	env, ok := resource.(*environmentv1.Environment)
	if !ok {
		return nil
	}

	meta := env.GetMetadata()
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

	if audit := env.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
