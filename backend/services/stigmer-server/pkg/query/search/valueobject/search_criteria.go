// Package valueobject contains immutable value objects for the search domain.
// These objects encapsulate validated, normalized data with no identity.
package valueobject

import (
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Search parameter constants
const (
	// DefaultPageSize is the default number of results per page.
	DefaultPageSize = 20

	// MaxPageSize is the maximum allowed page size.
	MaxPageSize = 100

	// MaxQueryLength is the maximum allowed search query length.
	MaxQueryLength = 500
)

// SearchableKinds defines the set of resource kinds that support search operations.
// These are the only kinds that can be searched via the SearchService.
//
// Must stay in step with the extractor registry (pkg/query/search/extractor):
// a kind indexed on write but absent here is silently unqueryable — the
// CLI's search-backed `list environment` and the React SDK's
// useSessionSearch hook depend on their entries.
// agent_channel and channel_app are deliberately absent (not_search_indexed
// by design; the CLI lists them via their dedicated query RPCs).
//
// TestSearchableKinds_CoverSearchIndexedProtoKinds pins this map against the
// proto kind registry's not_search_indexed annotation: adding an extractor
// for a new kind without deciding its entry here fails the suite instead of
// shipping a silently-empty read path (the defect environment, project, and
// session each shipped with).
var SearchableKinds = map[apiresourcekind.ApiResourceKind]bool{
	apiresourcekind.ApiResourceKind_agent:       true,
	apiresourcekind.ApiResourceKind_skill:       true,
	apiresourcekind.ApiResourceKind_mcp_server:  true,
	apiresourcekind.ApiResourceKind_workflow:    true,
	apiresourcekind.ApiResourceKind_project:     true,
	apiresourcekind.ApiResourceKind_environment: true,
	apiresourcekind.ApiResourceKind_session:     true,
}

// SearchCriteria is an immutable value object encapsulating all search parameters.
//
// It validates and normalizes all search parameters at construction time.
// SearchCriteria supports three search modes:
//   - List mode: No query provided, returns all accessible resources sorted by created_at DESC
//   - Search mode: Query provided with specific kind(s), sorted by relevance
//   - Discover mode: Query provided with no kinds (searches all), sorted by relevance
//
// kinds holds the request verbatim; filtering to SearchableKinds happens in
// EffectiveKinds. Keeping the raw request is what lets EffectiveKinds
// distinguish "no kinds requested" (discover mode) from "kinds requested but
// none searchable" (empty result) — collapsing the two at construction time
// made kind-targeted requests for non-searchable kinds silently degrade to
// discover mode and return every other kind's resources
// (stigmer/stigmer#440).
//
// Deliberate twin: the cloud edition's SearchCriteria.java implements the
// same contract against its registry-driven searchable set — change the two
// together.
type SearchCriteria struct {
	kinds          []apiresourcekind.ApiResourceKind
	query          string
	orgFilter      string
	excludePublic  bool
	crossOrgPublic bool
	pageNumber     int32
	pageSize       int32
}

// NewSearchCriteria creates a validated SearchCriteria from the provided parameters.
//
// Parameters:
//   - kinds: Resource kinds to search (nil or empty = discover mode)
//   - query: Search query (empty = list mode)
//   - orgFilter: Organization to scope search (empty = all orgs)
//   - excludePublic: Whether to exclude public/platform resources
//   - crossOrgPublic: When true and orgFilter is set, also include public resources from other orgs
//   - pageNumber: Page number (1-indexed, will be clamped to minimum of 1)
//   - pageSize: Items per page (will be clamped to 1-100 range)
//
// Returns an error if the query exceeds MaxQueryLength.
func NewSearchCriteria(
	kinds []apiresourcekind.ApiResourceKind,
	query string,
	orgFilter string,
	excludePublic bool,
	crossOrgPublic bool,
	pageNumber int32,
	pageSize int32,
) (*SearchCriteria, error) {
	// Keep the requested kinds verbatim (defensively copied); EffectiveKinds
	// applies the searchable filter at read time (see the type comment).
	requestedKinds := make([]apiresourcekind.ApiResourceKind, len(kinds))
	copy(requestedKinds, kinds)

	// Normalize and validate query
	normalizedQuery := strings.TrimSpace(query)
	if len(normalizedQuery) > MaxQueryLength {
		return nil, fmt.Errorf("search query exceeds maximum length of %d characters", MaxQueryLength)
	}

	// Normalize org filter
	normalizedOrg := strings.TrimSpace(orgFilter)

	// Clamp pagination values to valid ranges
	if pageNumber < 1 {
		pageNumber = 1
	}
	if pageSize < 1 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}

	return &SearchCriteria{
		kinds:          requestedKinds,
		query:          normalizedQuery,
		orgFilter:      normalizedOrg,
		excludePublic:  excludePublic,
		crossOrgPublic: crossOrgPublic,
		pageNumber:     pageNumber,
		pageSize:       pageSize,
	}, nil
}

// Kinds returns the requested resource kinds verbatim — including any that
// are not searchable. Use EffectiveKinds for the set actually searched.
// Returns an empty slice for discover mode (search all kinds).
func (c *SearchCriteria) Kinds() []apiresourcekind.ApiResourceKind {
	// Return a copy to preserve immutability
	result := make([]apiresourcekind.ApiResourceKind, len(c.kinds))
	copy(result, c.kinds)
	return result
}

// Query returns the search query string.
// Returns an empty string for list mode (return all resources).
func (c *SearchCriteria) Query() string {
	return c.query
}

// OrgFilter returns the organization filter.
// Returns an empty string if searching all accessible organizations.
func (c *SearchCriteria) OrgFilter() string {
	return c.orgFilter
}

// ExcludePublic returns whether to exclude public/platform resources.
func (c *SearchCriteria) ExcludePublic() bool {
	return c.excludePublic
}

// CrossOrgPublic returns whether to include public resources from orgs
// other than the org filter. Only meaningful when HasOrgFilter() is true.
func (c *SearchCriteria) CrossOrgPublic() bool {
	return c.crossOrgPublic
}

// PageNumber returns the page number (1-indexed).
func (c *SearchCriteria) PageNumber() int32 {
	return c.pageNumber
}

// PageSize returns the number of results per page.
func (c *SearchCriteria) PageSize() int32 {
	return c.pageSize
}

// IsDiscoverMode returns true if this is discover mode (search all resource types).
// Discover mode is when no specific kinds are requested. A request naming
// only non-searchable kinds is NOT discover mode — it searches nothing.
func (c *SearchCriteria) IsDiscoverMode() bool {
	return len(c.kinds) == 0
}

// HasQuery returns true if a search query was provided.
// When false, this is "list mode" (return all accessible resources).
func (c *SearchCriteria) HasQuery() bool {
	return c.query != ""
}

// HasOrgFilter returns true if an organization filter was provided.
func (c *SearchCriteria) HasOrgFilter() bool {
	return c.orgFilter != ""
}

// EffectiveKinds returns the set of kinds to actually search.
//
// In discover mode (no kinds requested), returns all searchable kinds.
// Otherwise, returns the requested kinds filtered to SearchableKinds (that
// map is the single source of truth — enumerating it here rotted twice);
// non-searchable kinds are silently dropped, the forward-compatibility
// contract documented on SearchRequest.kinds.
//
// The filtered set may be EMPTY: a request naming only non-searchable kinds
// must return an empty result, and the stores short-circuit an empty
// effective set. Falling back to all searchable kinds here instead served
// every other kind's resources for such requests (stigmer/stigmer#440).
func (c *SearchCriteria) EffectiveKinds() []apiresourcekind.ApiResourceKind {
	if len(c.kinds) == 0 {
		// Return all searchable kinds
		result := make([]apiresourcekind.ApiResourceKind, 0, len(SearchableKinds))
		for k := range SearchableKinds {
			result = append(result, k)
		}
		return result
	}
	result := make([]apiresourcekind.ApiResourceKind, 0, len(c.kinds))
	for _, k := range c.kinds {
		if SearchableKinds[k] {
			result = append(result, k)
		}
	}
	return result
}

// Offset calculates the offset for database queries based on page number and size.
// Returns the number of items to skip (zero-indexed).
func (c *SearchCriteria) Offset() int32 {
	return (c.pageNumber - 1) * c.pageSize
}
