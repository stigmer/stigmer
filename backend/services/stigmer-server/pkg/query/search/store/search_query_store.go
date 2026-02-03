// Package store provides the data access layer for search operations.
//
// This package implements the Query Store pattern from CQRS - a read-optimized
// data access layer that returns projections (DTOs/protos), not domain entities.
// It has no business invariants to protect and doesn't modify state.
//
// # Design Rationale
//
// Unlike DDD Repositories that work with domain aggregates, a Query Store:
//   - Returns read-optimized projections (SearchResult protos)
//   - Performs cross-aggregate queries (searches multiple resource types)
//   - Has no business logic or invariants
//   - Is optimized for query performance (FTS5 indexes, etc.)
//
// # Authorization Model
//
// For the OSS (single-user) version, there is no authorization layer.
// All resources in the local database are accessible to the user.
// The cloud version has a separate authorization step using OpenFGA.
package store

import (
	"context"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/valueobject"
)

// SearchQueryStore defines the interface for search query operations.
//
// This is a Query Store (CQRS read-side), not a Repository:
//   - Returns DTOs/protos optimized for display, not domain entities
//   - Performs cross-aggregate queries across multiple resource types
//   - Has no business invariants or domain logic
//   - Is optimized for query performance
//
// Implementations:
//   - SQLiteSearchQueryStore: Uses FTS5 for full-text search
//   - (Future) MongoSearchQueryStore: Uses MongoDB text indexes
type SearchQueryStore interface {
	// Search executes a search query against the FTS5 index.
	//
	// Behavior varies based on criteria:
	//   - With query (search mode): Full-text search sorted by relevance
	//   - Without query (list mode): All resources sorted by created_at DESC
	//   - Empty kinds (discover mode): Searches all searchable resource types
	//
	// Parameters:
	//   - ctx: Context for cancellation and timeouts
	//   - criteria: Validated search criteria (kinds, query, org, pagination)
	//
	// Returns:
	//   - SearchPagedResult containing results, counts, and pagination metadata
	//   - Error if the query fails
	//
	// The search respects the following filters from criteria:
	//   - kinds: Which resource types to search (or all if empty)
	//   - query: Full-text search query (or empty for list mode)
	//   - orgFilter: Scope to a specific organization
	//   - excludePublic: Exclude public/platform resources
	//   - pagination: Page number and size
	Search(ctx context.Context, criteria *valueobject.SearchCriteria) (*valueobject.SearchPagedResult, error)

	// RebuildIndex rebuilds the FTS5 search index from the resources table.
	//
	// This is useful for:
	//   - Initial population after migration
	//   - Recovery from index corruption
	//   - Ensuring index consistency
	//
	// The operation is idempotent - running it multiple times produces
	// the same result.
	//
	// Parameters:
	//   - ctx: Context for cancellation and timeouts
	//
	// Returns:
	//   - Number of resources indexed
	//   - Error if the rebuild fails
	RebuildIndex(ctx context.Context) (int, error)
}
