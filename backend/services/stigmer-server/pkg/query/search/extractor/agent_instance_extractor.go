package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// AgentInstanceExtractor extracts searchable data from AgentInstance resources.
//
// Agent instances are running incarnations of an agent definition, bound to a
// specific configuration and MCP server set. The summary uses spec.description.
type AgentInstanceExtractor struct{}

var _ SearchableExtractor = (*AgentInstanceExtractor)(nil)

func init() {
	Register(&AgentInstanceExtractor{})
}

func (e *AgentInstanceExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_agent_instance
}

func (e *AgentInstanceExtractor) NewEmptyProto() proto.Message {
	return &agentinstancev1.AgentInstance{}
}

func (e *AgentInstanceExtractor) GetSearchSummary(resource proto.Message) string {
	ai, ok := resource.(*agentinstancev1.AgentInstance)
	if !ok || ai.GetSpec() == nil {
		return ""
	}
	return ai.GetSpec().GetDescription()
}

func (e *AgentInstanceExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	ai, ok := resource.(*agentinstancev1.AgentInstance)
	if !ok {
		return nil
	}

	meta := ai.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_agent_instance,
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

	if audit := ai.GetStatus().GetAudit(); audit != nil {
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

func (e *AgentInstanceExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	ai, ok := resource.(*agentinstancev1.AgentInstance)
	if !ok {
		return nil
	}

	meta := ai.GetMetadata()
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

	if audit := ai.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
