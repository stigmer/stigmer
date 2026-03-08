package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// AgentExecutionExtractor extracts searchable data from AgentExecution resources.
//
// Agent executions are individual invocation records. They have no description
// field, so the summary is the resource name.
type AgentExecutionExtractor struct{}

var _ SearchableExtractor = (*AgentExecutionExtractor)(nil)

func init() {
	Register(&AgentExecutionExtractor{})
}

func (e *AgentExecutionExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_agent_execution
}

func (e *AgentExecutionExtractor) NewEmptyProto() proto.Message {
	return &agentexecutionv1.AgentExecution{}
}

func (e *AgentExecutionExtractor) GetSearchSummary(resource proto.Message) string {
	exec, ok := resource.(*agentexecutionv1.AgentExecution)
	if !ok || exec.GetMetadata() == nil {
		return ""
	}
	return exec.GetMetadata().GetName()
}

func (e *AgentExecutionExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	exec, ok := resource.(*agentexecutionv1.AgentExecution)
	if !ok {
		return nil
	}

	meta := exec.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_agent_execution,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Description:   "",
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
	}

	if audit := exec.GetStatus().GetAudit(); audit != nil {
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

func (e *AgentExecutionExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	exec, ok := resource.(*agentexecutionv1.AgentExecution)
	if !ok {
		return nil
	}

	meta := exec.GetMetadata()
	if meta == nil {
		return nil
	}

	entry := &store.SearchIndexEntry{
		Name:       meta.GetName(),
		Tags:       JoinTags(meta.GetTags()),
		Org:        meta.GetOrg(),
		Visibility: meta.GetVisibility().String(),
	}

	if audit := exec.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
