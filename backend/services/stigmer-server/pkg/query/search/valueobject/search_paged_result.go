package valueobject

import (
	"fmt"
	"math"

	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
)

// SearchPagedResult is an immutable value object containing paginated search results
// with metadata needed to build the SearchResponse proto.
//
// All slices and maps are defensively copied on construction to ensure immutability.
// This makes the object safe for concurrent access without synchronization.
//
// Usage:
//
//	result := NewSearchPagedResult(searchResults, countsByKind, totalCount, pageSize)
//	response := &searchv1.SearchResponse{
//	    Entries:      result.Results(),
//	    CountsByKind: result.CountsByKind(),
//	    TotalCount:   result.TotalCount(),
//	    TotalPages:   result.TotalPages(),
//	}
type SearchPagedResult struct {
	results      []*searchv1.SearchResult
	countsByKind map[string]int32
	totalCount   int32
	totalPages   int32
}

// emptyResult is a singleton empty result to avoid allocations.
var emptyResult = &SearchPagedResult{
	results:      []*searchv1.SearchResult{},
	countsByKind: map[string]int32{},
	totalCount:   0,
	totalPages:   0,
}

// NewSearchPagedResult creates a new SearchPagedResult with the provided data.
// Total pages is calculated automatically from totalCount and pageSize.
//
// Parameters:
//   - results: Search results for the current page (will be copied)
//   - countsByKind: Total count of matching resources per kind (will be copied)
//   - totalCount: Total count of matching resources across all kinds
//   - pageSize: Page size used for pagination (for calculating totalPages)
//
// Returns an error if totalCount or pageSize is negative.
func NewSearchPagedResult(
	results []*searchv1.SearchResult,
	countsByKind map[string]int32,
	totalCount int32,
	pageSize int32,
) (*SearchPagedResult, error) {
	if totalCount < 0 {
		return nil, fmt.Errorf("totalCount cannot be negative: %d", totalCount)
	}
	if pageSize < 0 {
		return nil, fmt.Errorf("pageSize cannot be negative: %d", pageSize)
	}

	// Calculate total pages
	var totalPages int32
	if pageSize > 0 {
		totalPages = int32(math.Ceil(float64(totalCount) / float64(pageSize)))
	}

	// Defensive copy of results
	resultsCopy := make([]*searchv1.SearchResult, len(results))
	copy(resultsCopy, results)

	// Defensive copy of countsByKind
	countsCopy := make(map[string]int32, len(countsByKind))
	for k, v := range countsByKind {
		countsCopy[k] = v
	}

	return &SearchPagedResult{
		results:      resultsCopy,
		countsByKind: countsCopy,
		totalCount:   totalCount,
		totalPages:   totalPages,
	}, nil
}

// EmptyResult returns a singleton empty SearchPagedResult.
// Use this for cases where no results were found.
func EmptyResult() *SearchPagedResult {
	return emptyResult
}

// Results returns the search results for the current page.
// Returns a copy of the internal slice to preserve immutability.
func (r *SearchPagedResult) Results() []*searchv1.SearchResult {
	result := make([]*searchv1.SearchResult, len(r.results))
	copy(result, r.results)
	return result
}

// CountsByKind returns the total count of matching resources per kind.
// Keys are ApiResourceKind enum names as strings (e.g., "agent", "skill").
// Values are the total count (not just the current page).
// Returns a copy of the internal map to preserve immutability.
func (r *SearchPagedResult) CountsByKind() map[string]int32 {
	result := make(map[string]int32, len(r.countsByKind))
	for k, v := range r.countsByKind {
		result[k] = v
	}
	return result
}

// TotalCount returns the total count of matching resources across all kinds.
func (r *SearchPagedResult) TotalCount() int32 {
	return r.totalCount
}

// TotalPages returns the total number of pages based on the page size.
func (r *SearchPagedResult) TotalPages() int32 {
	return r.totalPages
}

// IsEmpty returns true if there are no results.
func (r *SearchPagedResult) IsEmpty() bool {
	return len(r.results) == 0
}

// PageSize returns the number of results in the current page.
// Note: This may be less than the requested page size for the last page.
func (r *SearchPagedResult) PageSize() int {
	return len(r.results)
}
