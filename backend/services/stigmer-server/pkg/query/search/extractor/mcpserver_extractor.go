package extractor

import (
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// McpServerExtractor extracts searchable data from McpServer resources.
//
// McpServers are Model Context Protocol server configurations that provide
// tools and context to agents. The search summary uses the description field
// from the spec.
type McpServerExtractor struct{}

// Compile-time assertion that McpServerExtractor implements SearchableExtractor.
var _ SearchableExtractor = (*McpServerExtractor)(nil)

func init() {
	Register(&McpServerExtractor{})
}

// Kind returns the resource kind this extractor handles.
func (e *McpServerExtractor) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_mcp_server
}

// NewEmptyProto returns a new zero-value McpServer proto.
func (e *McpServerExtractor) NewEmptyProto() proto.Message {
	return &mcpserverv1.McpServer{}
}

// GetSearchSummary extracts the display summary for search results.
// Returns spec.description.
func (e *McpServerExtractor) GetSearchSummary(resource proto.Message) string {
	mcp, ok := resource.(*mcpserverv1.McpServer)
	if !ok || mcp.GetSpec() == nil {
		return ""
	}

	return mcp.GetSpec().GetDescription()
}

// ToSearchResult converts the McpServer to a SearchResult proto.
func (e *McpServerExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	mcp, ok := resource.(*mcpserverv1.McpServer)
	if !ok {
		return nil
	}

	meta := mcp.GetMetadata()
	if meta == nil {
		return nil
	}

	result := &searchv1.SearchResult{
		Kind:          apiresourcekind.ApiResourceKind_mcp_server,
		Id:            meta.GetId(),
		Name:          meta.GetName(),
		Slug:          meta.GetSlug(),
		Org:           meta.GetOrg(),
		QualifiedSlug: buildQualifiedSlug(meta.GetOrg(), meta.GetSlug()),
		Description:   e.GetSearchSummary(resource),
		Visibility:    meta.GetVisibility(),
		Tags:          meta.GetTags(),
		Score:         score,
		IconUrl:       mcp.GetSpec().GetIconUrl(),
	}

	// Extract audit timestamps
	if audit := mcp.GetStatus().GetAudit(); audit != nil {
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
func (e *McpServerExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	mcp, ok := resource.(*mcpserverv1.McpServer)
	if !ok {
		return nil
	}

	meta := mcp.GetMetadata()
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
	if audit := mcp.GetStatus().GetAudit(); audit != nil {
		if specAudit := audit.GetSpecAudit(); specAudit != nil {
			if specAudit.GetCreatedAt() != nil {
				entry.CreatedAt = specAudit.GetCreatedAt().GetSeconds()
			}
		}
	}

	return entry
}
