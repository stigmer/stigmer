package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// AgentExtractor extracts searchable data from Agent resources.
//
// The search summary uses the agent's description field if available,
// falling back to instructions (the system prompt) if description is empty.
// This supports the common pattern where older agents may not have a
// dedicated description field, but all agents have instructions.
type AgentExtractor struct{}

// Compile-time assertion that AgentExtractor implements SearchableExtractor.
var _ SearchableExtractor = (*AgentExtractor)(nil)

func init() {
	Register(&AgentExtractor{})
}

// Kind returns the resource kind this extractor handles.
func (e *AgentExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_agent
}

// NewEmptyProto returns a new zero-value Agent proto.
func (e *AgentExtractor) NewEmptyProto() proto.Message {
	return &agentv1.Agent{}
}

// GetSearchSummary extracts the display summary for search results.
// Returns spec.description if available, otherwise spec.instructions.
func (e *AgentExtractor) GetSearchSummary(resource proto.Message) string {
	agent, ok := resource.(*agentv1.Agent)
	if !ok || agent.GetSpec() == nil {
		return ""
	}

	spec := agent.GetSpec()

	// Prefer description if available, fall back to instructions
	if spec.GetDescription() != "" {
		return spec.GetDescription()
	}

	return spec.GetInstructions()
}

// ToSearchResult converts the Agent to a SearchResult proto.
func (e *AgentExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	agent, ok := resource.(*agentv1.Agent)
	if !ok {
		return nil
	}

	meta := agent.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_agent,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Description:   e.GetSearchSummary(resource),
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
		IconUrl:       agent.GetSpec().GetIconUrl(),
	}

	// Extract audit timestamps
	if audit := agent.GetStatus().GetAudit(); audit != nil {
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
func (e *AgentExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	agent, ok := resource.(*agentv1.Agent)
	if !ok {
		return nil
	}

	meta := agent.GetMetadata()
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
	if audit := agent.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}

// buildQualifiedSlug creates the "org/slug" format.
func buildQualifiedSlug(org, slug string) string {
	if org == "" {
		return slug
	}
	return org + "/" + slug
}
