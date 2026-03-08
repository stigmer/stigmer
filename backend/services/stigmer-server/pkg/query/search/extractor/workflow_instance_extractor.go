package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// WorkflowInstanceExtractor extracts searchable data from WorkflowInstance resources.
//
// Workflow instances are running incarnations of a workflow definition.
// The summary uses spec.description.
type WorkflowInstanceExtractor struct{}

var _ SearchableExtractor = (*WorkflowInstanceExtractor)(nil)

func init() {
	Register(&WorkflowInstanceExtractor{})
}

func (e *WorkflowInstanceExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_workflow_instance
}

func (e *WorkflowInstanceExtractor) NewEmptyProto() proto.Message {
	return &workflowinstancev1.WorkflowInstance{}
}

func (e *WorkflowInstanceExtractor) GetSearchSummary(resource proto.Message) string {
	wi, ok := resource.(*workflowinstancev1.WorkflowInstance)
	if !ok || wi.GetSpec() == nil {
		return ""
	}
	return wi.GetSpec().GetDescription()
}

func (e *WorkflowInstanceExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	wi, ok := resource.(*workflowinstancev1.WorkflowInstance)
	if !ok {
		return nil
	}

	meta := wi.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_workflow_instance,
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

	if audit := wi.GetStatus().GetAudit(); audit != nil {
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

func (e *WorkflowInstanceExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	wi, ok := resource.(*workflowinstancev1.WorkflowInstance)
	if !ok {
		return nil
	}

	meta := wi.GetMetadata()
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

	if audit := wi.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
