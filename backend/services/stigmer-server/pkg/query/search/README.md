# Search Query Layer - CQRS Read Side

This package implements the query layer for the unified Search bounded context, providing full-text search across all searchable API resources (Agent, Skill, McpServer, Workflow, Project, Datastore, Environment).

## Architecture Overview

This is a **CQRS Query Service** - it reads from multiple domain aggregates and returns display-optimized projections via the `SearchResult` proto. It does not modify state.

```
query/search/
├── README.md                    # This documentation
├── controller/
│   └── search_controller.go     # gRPC router (implements SearchServiceServer)
├── extractor/
│   ├── extractor.go             # Strategy interface
│   ├── registry.go              # Registry (auto-discovery via init())
│   ├── agent_extractor.go       # Agent-specific extraction
│   ├── skill_extractor.go       # Skill-specific extraction
│   ├── mcpserver_extractor.go   # McpServer-specific extraction
│   └── workflow_extractor.go    # Workflow-specific extraction
├── handler/
│   └── search_handler.go        # Pipeline handler
├── store/
│   ├── search_query_store.go    # Query store interface
│   └── sqlite_search_query_store.go  # SQLite FTS5 implementation
└── valueobject/
    ├── search_criteria.go       # Search parameters (validated)
    └── search_paged_result.go   # Paginated results container
```

## Request Flow

```
SearchRequest
      │
      ▼
SearchController (gRPC)
      │
      ├─► ValidateRequest ─► buf.validate proto constraints
      │
      ├─► BuildSearchCriteria ─► SearchCriteria (validated value object)
      │
      ├─► ExecuteSearch ─► SQLiteSearchQueryStore
      │                         │
      │                         ├─► Query FTS5 index (search_index table)
      │                         ├─► Load resources from main store
      │                         └─► Convert via SearchableExtractor
      │
      ▼
SearchResponse
```

## Design Principles

### Strategy Pattern (Extractors)

Each searchable resource type has a dedicated extractor that implements `SearchableExtractor`:

```go
type SearchableExtractor interface {
    Kind() apiresourcekind.ApiResourceKind
    GetSearchSummary(msg proto.Message) string
    ToSearchResult(msg proto.Message, score float32) *searchv1.SearchResult
    GetSearchIndexEntry(msg proto.Message) *store.SearchIndexEntry
}
```

This enables polymorphic resource handling without modifying protobuf classes (which can't implement interfaces).

**Benefits:**
- **Open-Closed Principle**: Add new searchable resources by implementing a new extractor
- **Single Responsibility**: Each extractor knows only its own resource type
- **Auto-Discovery**: Extractors register themselves via `init()` functions

### Query Store Pattern (CQRS)

The `SearchQueryStore` interface follows the Query Store pattern:

```go
type SearchQueryStore interface {
    Search(ctx context.Context, criteria *valueobject.SearchCriteria) (*valueobject.SearchPagedResult, error)
    RebuildIndex(ctx context.Context) (int, error)
}
```

Unlike DDD Repositories that work with domain aggregates:
- Returns read-optimized projections (SearchResult protos)
- Performs cross-aggregate queries
- Has no business invariants
- Optimized for query performance (FTS5 indexes)

### Value Objects

Immutable value objects provide validation and encapsulation:

**SearchCriteria:**
- Validates and normalizes search parameters
- Filters to searchable kinds only
- Handles pagination bounds (1-100 page size)
- Provides computed properties (`IsDiscoverMode()`, `HasQuery()`, `EffectiveKinds()`)

**SearchPagedResult:**
- Defensive copying ensures immutability
- Contains results, counts by kind, and pagination metadata
- Factory methods for common cases (`EmptyResult()`, `NewSearchPagedResult()`)

## Full-Text Search (FTS5)

The `search_index` table is an FTS5 virtual table for full-text search:

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
    kind,                    -- Resource type
    resource_id UNINDEXED,   -- Join key (not searchable)
    name,                    -- Weight: 10 (via BM25)
    description,             -- Weight: 5
    tags,                    -- Weight: 5
    org UNINDEXED,           -- Filter field (not searchable)
    visibility UNINDEXED,    -- Filter field (not searchable)
    created_at UNINDEXED,    -- Sort field (not searchable)
    tokenize='porter unicode61'
);
```

**FTS5 Features Used:**
- **Porter Stemming**: "deploy" matches "deployment"
- **Unicode Support**: Handles international characters
- **BM25 Ranking**: Relevance-based result ordering
- **Prefix Matching**: Single-word queries get `*` suffix

## Search Modes

| Mode | kinds | query | Behavior |
|------|-------|-------|----------|
| List | [X] | "" | All X, sorted by created_at DESC |
| Search | [X] | "..." | Search X, sorted by relevance |
| Discover | [] | "..." | Search all kinds, sorted by relevance |

## Authorization Model (OSS vs Cloud)

**OSS (this implementation):**
- Single-user local mode
- No authorization step
- All resources in the local database are accessible

**Cloud version:**
- Adds `QueryAuthorizedIds` step
- Queries OpenFGA for authorized resource IDs per kind
- Filters results to only authorized resources

## Usage Examples

### CLI Integration

```bash
# List agents in current org
stigmer list agents

# Search agents
stigmer search agents "kubernetes"

# Discover across all kinds
stigmer discover "code review"
```

### gRPC Request Examples

```protobuf
// List agents in an org
SearchRequest {
  kinds: [agent]
  org: "acme"
  query: ""
}

// Search agents by text
SearchRequest {
  kinds: [agent]
  query: "code review"
}

// Discover all resources
SearchRequest {
  kinds: []
  query: "kubernetes"
}
```

## Adding a New Searchable Resource

1. **Create Extractor**: Implement `SearchableExtractor` in `extractor/` directory

```go
type NewResourceExtractor struct{}

func init() {
    Register(&NewResourceExtractor{})
}

func (e *NewResourceExtractor) Kind() apiresourcekind.ApiResourceKind {
    return apiresourcekind.ApiResourceKind_new_resource
}

// Implement other methods...
```

2. **Update SearchableKinds**: Add to `valueobject/search_criteria.go`:

```go
var SearchableKinds = map[apiresourcekind.ApiResourceKind]bool{
    // ...existing kinds...
    apiresourcekind.ApiResourceKind_new_resource: true,
}
```

3. **Update createEmptyProtoForKind**: Add case in `store/sqlite_search_query_store.go`:

```go
case apiresourcekind.ApiResourceKind_new_resource:
    return &newresourcev1.NewResource{}
```

4. **Update BUILD.bazel**: Add proto dependency to `extractor/BUILD.bazel`

## Testing

```bash
# Run all search tests
bazel test //backend/services/stigmer-server/pkg/query/search/...

# Run specific package tests
bazel test //backend/services/stigmer-server/pkg/query/search/valueobject:valueobject_test
bazel test //backend/services/stigmer-server/pkg/query/search/extractor:extractor_test
bazel test //backend/services/stigmer-server/pkg/query/search/store:store_test
```

## Related Documentation

- [SearchService Proto](../../../../../apis/ai/stigmer/search/v1/query.proto) - gRPC service definition
- [Search Request/Response](../../../../../apis/ai/stigmer/search/v1/io.proto) - Message types
- [SQLite Store](../../../../libs/go/store/sqlite/store.go) - FTS5 migration (V3)
