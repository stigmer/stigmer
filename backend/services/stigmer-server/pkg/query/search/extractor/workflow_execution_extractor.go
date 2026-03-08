package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// WorkflowExecutionExtractor extracts searchable data from WorkflowExecution resources.
//
// Workflow executions are invocation records for workflow instances. They have
// no description field, so the summary is empty.
type WorkflowExecutionExtractor struct{}

var _ SearchableExtractor = (*WorkflowExecutionExtractor)(nil)

func init() {
	Register(&WorkflowExecutionExtractor{})
}

func (e *WorkflowExecutionExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_workflow_execution
}

func (e *WorkflowExecutionExtractor) NewEmptyProto() proto.Message {
	return &workflowexecutionv1.WorkflowExecution{}
}

func (e *WorkflowExecutionExtractor) GetSearchSummary(resource proto.Message) string {
	return ""
}

func (e *WorkflowExecutionExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	we, ok := resource.(*workflowexecutionv1.WorkflowExecution)
	if !ok {
		return nil
	}

	meta := we.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_workflow_execution,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
	}

	if audit := we.GetStatus().GetAudit(); audit != nil {
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

func (e *WorkflowExecutionExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	we, ok := resource.(*workflowexecutionv1.WorkflowExecution)
	if !ok {
		return nil
	}

	meta := we.GetMetadata()
	if meta == nil {
		return nil
	}

	entry := &store.SearchIndexEntry{
		Name:       meta.GetName(),
		Tags:       JoinTags(meta.GetTags()),
		Org:        meta.GetOrg(),
		Visibility: meta.GetVisibility().String(),
	}

	if audit := we.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
