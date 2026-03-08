package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ExecutionContextExtractor extracts searchable data from ExecutionContext resources.
//
// Execution contexts hold ephemeral state for agent/workflow executions. They
// have no description field, so the summary is empty.
type ExecutionContextExtractor struct{}

var _ SearchableExtractor = (*ExecutionContextExtractor)(nil)

func init() {
	Register(&ExecutionContextExtractor{})
}

func (e *ExecutionContextExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_execution_context
}

func (e *ExecutionContextExtractor) NewEmptyProto() proto.Message {
	return &executioncontextv1.ExecutionContext{}
}

func (e *ExecutionContextExtractor) GetSearchSummary(resource proto.Message) string {
	return ""
}

func (e *ExecutionContextExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	ec, ok := resource.(*executioncontextv1.ExecutionContext)
	if !ok {
		return nil
	}

	meta := ec.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_execution_context,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
	}

	if audit := ec.GetStatus().GetAudit(); audit != nil {
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

func (e *ExecutionContextExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	ec, ok := resource.(*executioncontextv1.ExecutionContext)
	if !ok {
		return nil
	}

	meta := ec.GetMetadata()
	if meta == nil {
		return nil
	}

	entry := &store.SearchIndexEntry{
		Name:       meta.GetName(),
		Tags:       JoinTags(meta.GetTags()),
		Org:        meta.GetOrg(),
		Visibility: meta.GetVisibility().String(),
	}

	if audit := ec.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
