package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// WorkflowExtractor extracts searchable data from Workflow resources.
//
// Workflows are serverless workflow definitions using the Serverless Workflow
// Specification. The search summary uses the description field from the spec.
type WorkflowExtractor struct{}

// Compile-time assertion that WorkflowExtractor implements SearchableExtractor.
var _ SearchableExtractor = (*WorkflowExtractor)(nil)

func init() {
	Register(&WorkflowExtractor{})
}

// Kind returns the resource kind this extractor handles.
func (e *WorkflowExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_workflow
}

// NewEmptyProto returns a new zero-value Workflow proto.
func (e *WorkflowExtractor) NewEmptyProto() proto.Message {
	return &workflowv1.Workflow{}
}

// GetSearchSummary extracts the display summary for search results.
// Returns spec.description.
func (e *WorkflowExtractor) GetSearchSummary(resource proto.Message) string {
	workflow, ok := resource.(*workflowv1.Workflow)
	if !ok || workflow.GetSpec() == nil {
		return ""
	}

	return workflow.GetSpec().GetDescription()
}

// ToSearchResult converts the Workflow to a SearchResult proto.
func (e *WorkflowExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	workflow, ok := resource.(*workflowv1.Workflow)
	if !ok {
		return nil
	}

	meta := workflow.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_workflow,
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
	if audit := workflow.GetStatus().GetAudit(); audit != nil {
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
func (e *WorkflowExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	workflow, ok := resource.(*workflowv1.Workflow)
	if !ok {
		return nil
	}

	meta := workflow.GetMetadata()
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
	if audit := workflow.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
