// Package extractor provides the Strategy Pattern for extracting searchable data
// from API resources.
//
// # Design Rationale
//
// Domain entities in this codebase are protobuf-generated structs (e.g.,
// agentv1.Agent) which cannot have custom methods added. This Strategy Pattern
// provides:
//
//   - Open-Closed Principle: Adding new searchable resources only requires
//     implementing a new extractor, no changes to existing code
//   - Single Responsibility: Each extractor knows only its own resource type
//   - Polymorphism: Search handler works uniformly with all resource types
//   - Type Safety: Each extractor works with its specific proto type
//
// # Implementation Guidelines
//
// Implementations should:
//  1. Be registered with the SearchableResourceRegistry at init time
//  2. Return non-nil/non-empty values where possible (use "" for missing descriptions)
//  3. Handle missing fields gracefully (check for nil before accessing nested fields)
//  4. Extract timestamps as Unix seconds from the protobuf Timestamp type
package extractor

import (
	"strings"

	"google.golang.org/protobuf/proto"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// SearchableExtractor is the strategy interface for extracting searchable data
// from API resources.
//
// Since protobuf-generated structs cannot implement custom interfaces, we use
// extractors that know how to extract relevant data from each resource type's
// specific structure.
//
// Each searchable resource kind has a corresponding extractor implementation
// registered with the SearchableResourceRegistry.
type SearchableExtractor interface {
	// Kind returns the API resource kind this extractor handles.
	// This is used by SearchableResourceRegistry to map resource kinds to extractors.
	// Each kind should have exactly one extractor.
	Kind() apiresourcekind.ApiResourceKind

	// NewEmptyProto returns a new zero-value protobuf message of the type this
	// extractor handles. Used by RebuildIndex to unmarshal resources from the
	// store without maintaining a separate kind-to-proto mapping.
	NewEmptyProto() proto.Message

	// GetSearchSummary extracts the display summary for search results.
	//
	// This is the description shown in search result listings. The source
	// field varies by resource type (e.g., spec.description, spec.subject).
	//
	// Note: Truncation for display is a presentation concern handled by the
	// CLI or UI, not here. Return the full description.
	GetSearchSummary(resource proto.Message) string

	// ToSearchResult converts the resource to a SearchResult proto message.
	//
	// This method extracts all necessary fields from the resource and builds
	// the SearchResult proto that will be returned in the SearchResponse.
	//
	// Parameters:
	//   - resource: The protobuf resource message (must be the correct type for this extractor)
	//   - score: The relevance score from text search (0.0 to 1.0, use 1.0 for list mode)
	//
	// Returns a SearchResult proto for the response.
	ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult

	// GetSearchIndexEntry extracts the fields needed for the FTS5 search index.
	//
	// This method extracts name, description, tags, org, visibility, and created_at
	// from the resource for indexing in the search_index table.
	//
	// Returns a SearchIndexEntry suitable for passing to Store.UpsertSearchIndex.
	GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry
}

// BuildSearchableText combines the search index entry fields into a single
// searchable string for FTS5 full-text indexing.
//
// The combined text includes: name, description, and tags (space-separated).
// This is used for building the FTS5 MATCH query target.
func BuildSearchableText(entry *store.SearchIndexEntry) string {
	parts := []string{entry.Name}
	if entry.Description != "" {
		parts = append(parts, entry.Description)
	}
	if entry.Tags != "" {
		parts = append(parts, entry.Tags)
	}
	return strings.Join(parts, " ")
}

// JoinTags joins a slice of tags into a space-separated string for FTS5 indexing.
// FTS5 tokenizes on whitespace, so space-separated tags work well for search.
func JoinTags(tags []string) string {
	return strings.Join(tags, " ")
}
