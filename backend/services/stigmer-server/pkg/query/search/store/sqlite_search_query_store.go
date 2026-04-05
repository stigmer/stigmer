package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/proto"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	libstore "github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/valueobject"
)

// SQLiteSearchQueryStore implements SearchQueryStore using SQLite FTS5.
//
// It queries the search_index FTS5 virtual table for full-text search
// and joins with the resources table to retrieve the actual protobuf data.
//
// FTS5 Configuration:
//   - tokenize='porter unicode61': Porter stemming + Unicode support
//   - BM25 ranking for relevance scoring (built into FTS5)
//   - Weighted columns via custom ranking function
type SQLiteSearchQueryStore struct {
	db       *sql.DB
	store    libstore.Store
	registry *extractor.SearchableResourceRegistry
}

// Compile-time assertion that SQLiteSearchQueryStore implements SearchQueryStore.
var _ SearchQueryStore = (*SQLiteSearchQueryStore)(nil)

// NewSQLiteSearchQueryStore creates a new SQLite-backed search query store.
//
// Parameters:
//   - db: The SQLite database connection (should have search_index table)
//   - store: The resource store for retrieving protobuf data
//   - registry: The extractor registry for converting protos to SearchResults
func NewSQLiteSearchQueryStore(db *sql.DB, store libstore.Store, registry *extractor.SearchableResourceRegistry) *SQLiteSearchQueryStore {
	return &SQLiteSearchQueryStore{
		db:       db,
		store:    store,
		registry: registry,
	}
}

// Search executes a search query against the FTS5 index.
func (s *SQLiteSearchQueryStore) Search(ctx context.Context, criteria *valueobject.SearchCriteria) (*valueobject.SearchPagedResult, error) {
	effectiveKinds := criteria.EffectiveKinds()
	if len(effectiveKinds) == 0 {
		return valueobject.EmptyResult(), nil
	}

	if criteria.HasQuery() {
		return s.searchWithQuery(ctx, criteria, effectiveKinds)
	}
	return s.listWithoutQuery(ctx, criteria, effectiveKinds)
}

// searchWithQuery performs a full-text search with BM25 ranking.
func (s *SQLiteSearchQueryStore) searchWithQuery(
	ctx context.Context,
	criteria *valueobject.SearchCriteria,
	kinds []apiresourcekind.ApiResourceKind,
) (*valueobject.SearchPagedResult, error) {
	// Build the FTS5 MATCH query
	// Use bm25() for relevance scoring with custom weights:
	// name (weight 10), description (weight 5), tags (weight 5)
	// FTS5 columns are: kind, resource_id, name, description, tags, org, visibility, created_at
	// bm25() weights are in reverse column order, and we skip UNINDEXED columns
	// So: name(col 2), description(col 3), tags(col 4), kind(col 0)
	// bm25(search_index, 1.0, 0, 10.0, 5.0, 5.0) weights kind=1, resource_id=0, name=10, desc=5, tags=5

	// Build placeholders for kind IN clause
	kindStrings := make([]string, len(kinds))
	kindArgs := make([]interface{}, len(kinds))
	for i, k := range kinds {
		kindStrings[i] = "?"
		kindArgs[i] = k.String()
	}

	// Escape the query for FTS5 (handle special characters)
	escapedQuery := escapeFTS5Query(criteria.Query())

	scopeSQL, scopeArgs := s.buildScopeFilter(criteria)

	// Build the count query first (to get total counts per kind)
	countQuery := fmt.Sprintf(`
		SELECT kind, COUNT(*) as cnt
		FROM search_index
		WHERE search_index MATCH ?
		  AND kind IN (%s)
		  %s
		GROUP BY kind
	`, strings.Join(kindStrings, ","), scopeSQL)

	// Build args for count query
	countArgs := append([]interface{}{escapedQuery}, kindArgs...)
	countArgs = append(countArgs, scopeArgs...)

	// Execute count query
	countsByKind, totalCount, err := s.executeCountQuery(ctx, countQuery, countArgs)
	if err != nil {
		return nil, fmt.Errorf("execute count query: %w", err)
	}

	if totalCount == 0 {
		return valueobject.EmptyResult(), nil
	}

	// Build the search query with ranking
	searchQuery := fmt.Sprintf(`
		SELECT kind, resource_id, bm25(search_index, 1.0, 0, 10.0, 5.0, 5.0) as rank
		FROM search_index
		WHERE search_index MATCH ?
		  AND kind IN (%s)
		  %s
		ORDER BY rank
		LIMIT ? OFFSET ?
	`, strings.Join(kindStrings, ","), scopeSQL)

	// Build args for search query
	searchArgs := append([]interface{}{escapedQuery}, kindArgs...)
	searchArgs = append(searchArgs, scopeArgs...)
	searchArgs = append(searchArgs, criteria.PageSize(), criteria.Offset())

	// Execute search query
	results, err := s.executeSearchQuery(ctx, searchQuery, searchArgs)
	if err != nil {
		return nil, fmt.Errorf("execute search query: %w", err)
	}

	return valueobject.NewSearchPagedResult(results, countsByKind, totalCount, criteria.PageSize())
}

// listWithoutQuery lists resources sorted by created_at DESC.
func (s *SQLiteSearchQueryStore) listWithoutQuery(
	ctx context.Context,
	criteria *valueobject.SearchCriteria,
	kinds []apiresourcekind.ApiResourceKind,
) (*valueobject.SearchPagedResult, error) {
	// Build placeholders for kind IN clause
	kindStrings := make([]string, len(kinds))
	kindArgs := make([]interface{}, len(kinds))
	for i, k := range kinds {
		kindStrings[i] = "?"
		kindArgs[i] = k.String()
	}

	scopeSQL, scopeArgs := s.buildScopeFilter(criteria)

	// Build the count query
	countQuery := fmt.Sprintf(`
		SELECT kind, COUNT(*) as cnt
		FROM search_index
		WHERE kind IN (%s)
		  %s
		GROUP BY kind
	`, strings.Join(kindStrings, ","), scopeSQL)

	// Build args for count query
	countArgs := append([]interface{}{}, kindArgs...)
	countArgs = append(countArgs, scopeArgs...)

	// Execute count query
	countsByKind, totalCount, err := s.executeCountQuery(ctx, countQuery, countArgs)
	if err != nil {
		return nil, fmt.Errorf("execute count query: %w", err)
	}

	if totalCount == 0 {
		return valueobject.EmptyResult(), nil
	}

	// Build the list query (sorted by created_at DESC)
	listQuery := fmt.Sprintf(`
		SELECT kind, resource_id, 1.0 as rank
		FROM search_index
		WHERE kind IN (%s)
		  %s
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`, strings.Join(kindStrings, ","), scopeSQL)

	// Build args for list query
	listArgs := append([]interface{}{}, kindArgs...)
	listArgs = append(listArgs, scopeArgs...)
	listArgs = append(listArgs, criteria.PageSize(), criteria.Offset())

	// Execute list query
	results, err := s.executeSearchQuery(ctx, listQuery, listArgs)
	if err != nil {
		return nil, fmt.Errorf("execute list query: %w", err)
	}

	return valueobject.NewSearchPagedResult(results, countsByKind, totalCount, criteria.PageSize())
}

// buildScopeFilter returns a SQL WHERE fragment and its bind args for org
// and visibility filtering. The returned fragment is intended to be appended
// after a base WHERE clause (it starts with "AND ...").
//
// The three modes:
//   - org set, crossOrgPublic false: strict org filter
//   - org set, crossOrgPublic true:  org filter OR public from any org
//   - org empty:                     no org filter (all accessible orgs)
//
// excludePublic is applied independently on top of the above.
func (s *SQLiteSearchQueryStore) buildScopeFilter(criteria *valueobject.SearchCriteria) (string, []interface{}) {
	var clauses []string
	var args []interface{}

	if criteria.HasOrgFilter() {
		if criteria.CrossOrgPublic() {
			clauses = append(clauses, "AND (org = ? OR visibility = 'visibility_public')")
		} else {
			clauses = append(clauses, "AND org = ?")
		}
		args = append(args, criteria.OrgFilter())
	}

	if criteria.ExcludePublic() {
		clauses = append(clauses, "AND visibility != 'visibility_public'")
	}

	return strings.Join(clauses, "\n		  "), args
}

// executeCountQuery executes a count query and returns counts by kind.
func (s *SQLiteSearchQueryStore) executeCountQuery(
	ctx context.Context,
	query string,
	args []interface{},
) (map[string]int32, int32, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	countsByKind := make(map[string]int32)
	var totalCount int32

	for rows.Next() {
		var kind string
		var count int32
		if err := rows.Scan(&kind, &count); err != nil {
			return nil, 0, fmt.Errorf("scan row: %w", err)
		}
		countsByKind[kind] = count
		totalCount += count
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate rows: %w", err)
	}

	return countsByKind, totalCount, nil
}

// executeSearchQuery executes a search query and returns SearchResults.
func (s *SQLiteSearchQueryStore) executeSearchQuery(
	ctx context.Context,
	query string,
	args []interface{},
) ([]*searchv1.SearchResult, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	var results []*searchv1.SearchResult

	for rows.Next() {
		var kindStr, resourceID string
		var rank float64
		if err := rows.Scan(&kindStr, &resourceID, &rank); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}

		// Parse the kind
		kind, ok := parseKind(kindStr)
		if !ok {
			log.Warn().Str("kind", kindStr).Msg("Unknown resource kind in search index")
			continue
		}

		// Load the resource from the store
		result, err := s.loadAndConvertResource(ctx, kind, resourceID, normalizeScore(rank))
		if err != nil {
			log.Warn().Err(err).Str("kind", kindStr).Str("id", resourceID).Msg("Failed to load resource")
			continue
		}

		if result != nil {
			results = append(results, result)
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	return results, nil
}

// loadAndConvertResource loads a resource from the store and converts it to SearchResult.
func (s *SQLiteSearchQueryStore) loadAndConvertResource(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	resourceID string,
	score float32,
) (*searchv1.SearchResult, error) {
	// Get the extractor for this kind
	ext, err := s.registry.GetExtractor(kind)
	if err != nil {
		return nil, fmt.Errorf("get extractor: %w", err)
	}

	// Create a new proto message for this kind
	msg, err := s.createProtoForKind(kind)
	if err != nil {
		return nil, fmt.Errorf("create proto: %w", err)
	}

	// Load from store
	if err := s.store.GetResource(ctx, kind, resourceID, msg); err != nil {
		return nil, fmt.Errorf("get resource: %w", err)
	}

	// Convert to SearchResult using the extractor
	return ext.ToSearchResult(msg, score), nil
}

// createProtoForKind creates a new empty proto message for the given kind
// by delegating to the extractor registered for that kind.
func (s *SQLiteSearchQueryStore) createProtoForKind(kind apiresourcekind.ApiResourceKind) (proto.Message, error) {
	ext, err := s.registry.GetExtractor(kind)
	if err != nil {
		return nil, fmt.Errorf("unsupported kind: %s", kind)
	}
	return ext.NewEmptyProto(), nil
}

// RebuildIndex rebuilds the FTS5 search index from the resources table.
//
// This is resilient: if indexing a particular kind fails, it logs a warning
// and continues with remaining kinds. A combined error is returned at the end
// so callers can see which kinds failed, but all valid kinds are still indexed.
func (s *SQLiteSearchQueryStore) RebuildIndex(ctx context.Context) (int, error) {
	log.Info().Msg("Rebuilding search index...")

	// Clear existing index
	if _, err := s.db.ExecContext(ctx, "DELETE FROM search_index"); err != nil {
		return 0, fmt.Errorf("clear search index: %w", err)
	}

	var totalIndexed int
	var indexErrors []string

	// Index each searchable kind, continuing on per-kind failures
	for _, kind := range s.registry.SupportedKinds() {
		count, err := s.indexKind(ctx, kind)
		if err != nil {
			log.Warn().Err(err).Str("kind", kind.String()).Msg("Failed to index kind (continuing with remaining kinds)")
			indexErrors = append(indexErrors, fmt.Sprintf("%s: %v", kind, err))
			continue
		}
		totalIndexed += count
		log.Info().Str("kind", kind.String()).Int("count", count).Msg("Indexed resources")
	}

	if len(indexErrors) > 0 {
		log.Warn().Int("total", totalIndexed).Int("failed_kinds", len(indexErrors)).Msg("Search index rebuild completed with errors")
		return totalIndexed, fmt.Errorf("failed to index %d kind(s): %s", len(indexErrors), strings.Join(indexErrors, "; "))
	}

	log.Info().Int("total", totalIndexed).Msg("Search index rebuild complete")
	return totalIndexed, nil
}

// indexKind indexes all resources of a given kind.
func (s *SQLiteSearchQueryStore) indexKind(ctx context.Context, kind apiresourcekind.ApiResourceKind) (int, error) {
	// Get the extractor for this kind
	ext, err := s.registry.GetExtractor(kind)
	if err != nil {
		return 0, fmt.Errorf("get extractor: %w", err)
	}

	// List all resources of this kind
	dataList, err := s.store.ListResources(ctx, kind)
	if err != nil {
		return 0, fmt.Errorf("list resources: %w", err)
	}

	// Create proto message for unmarshaling via the extractor
	protoMsg := ext.NewEmptyProto()

	var count int
	for _, data := range dataList {
		// Reset and unmarshal
		proto.Reset(protoMsg)
		if err := proto.Unmarshal(data, protoMsg); err != nil {
			log.Warn().Err(err).Str("kind", kind.String()).Msg("Failed to unmarshal resource")
			continue
		}

		// Get the search index entry
		entry := ext.GetSearchIndexEntry(protoMsg)
		if entry == nil {
			continue
		}

		// Get the resource ID from the SearchResult (which has access to metadata)
		result := ext.ToSearchResult(protoMsg, 1.0)
		if result == nil {
			continue
		}

		// Upsert into the search index
		if err := s.store.UpsertSearchIndex(ctx, kind, result.Id, entry); err != nil {
			log.Warn().Err(err).Str("kind", kind.String()).Str("id", result.Id).Msg("Failed to index resource")
			continue
		}

		count++
	}

	return count, nil
}

// escapeFTS5Query sanitizes a query string for safe use in FTS5 MATCH
// expressions.
//
// Every whitespace-delimited token is individually double-quoted so that FTS5
// treats it as a literal phrase fragment rather than operator syntax. This
// prevents column-filter references (e.g. "server:term"), NOT/NEAR operators,
// and other FTS5 metacharacters from being interpreted. The porter unicode61
// tokenizer still applies inside quotes, so stemming and Unicode normalization
// work as expected.
//
// Single-token queries get a trailing '*' for prefix matching (valid on quoted
// terms in FTS5). Multi-token queries use implicit AND (all terms must match).
func escapeFTS5Query(query string) string {
	query = strings.TrimSpace(query)
	if query == "" {
		return query
	}

	words := strings.Fields(query)
	quoted := make([]string, 0, len(words))
	for _, w := range words {
		clean := strings.ReplaceAll(w, `"`, "")
		if clean == "" {
			continue
		}
		quoted = append(quoted, `"`+clean+`"`)
	}

	if len(quoted) == 0 {
		return ""
	}

	if len(quoted) == 1 {
		return quoted[0] + "*"
	}

	return strings.Join(quoted, " ")
}

// parseKind parses a kind string into an ApiResourceKind.
func parseKind(kindStr string) (apiresourcekind.ApiResourceKind, bool) {
	// Try to parse the kind from the string
	if val, ok := apiresourcekind.ApiResourceKind_value[kindStr]; ok {
		return apiresourcekind.ApiResourceKind(val), true
	}
	return 0, false
}

// normalizeScore normalizes the BM25 score to a 0-1 range.
// BM25 scores can vary widely; we use a sigmoid-like normalization.
func normalizeScore(bm25Score float64) float32 {
	// BM25 scores are typically negative (higher is better in FTS5)
	// We want to map them to 0-1 where higher is better
	// Using a simple transformation: score = 1 / (1 + exp(bm25))
	// Since bm25 is negative, this gives higher scores for better matches
	if bm25Score >= 0 {
		return 1.0
	}
	// Simple linear mapping for reasonable ranges
	// Typical BM25 scores are in the -5 to 0 range
	score := float32(1.0 + bm25Score/10.0)
	if score < 0 {
		score = 0
	}
	if score > 1 {
		score = 1
	}
	return score
}
