# Task T01: Unified Search API - Design and Implementation Plan

**Created**: 2026-02-01
**Status**: PENDING REVIEW
**Type**: Feature Development
**Timeline**: 1 week

---

## Executive Summary

Implement a **Search Bounded Context** with a single `search` RPC that handles all resource discovery operations:
- **List**: `{kinds: [AGENT], org: "acme", query: ""}` → List agents in "acme" org
- **Search**: `{kinds: [AGENT], query: "security"}` → Search agents matching "security"
- **Discover**: `{kinds: [], query: "kubernetes"}` → Discover all resources matching "kubernetes"

---

## Domain Analysis

### Why a Separate Search Bounded Context?

| Aspect | Current State | Proposed State |
|--------|---------------|----------------|
| Query Controllers | Only `get(id)` and `getByReference(org, slug)` | Keep as-is (point lookups only) |
| List/Search | Not implemented | New `SearchQueryController` service |
| Discovery | Not implemented | Same `search` RPC with `kinds: []` |
| Data Layer | N/A | Repository interface (MongoDB/SQLite now, ES later) |

### Design Principles

1. **Single RPC**: One `search` RPC handles list, search, and discover
2. **Lightweight Results**: Return display attributes only (not full resources)
3. **Extensible**: Adding new resource types doesn't require new RPCs
4. **Data Layer Agnostic**: Repository interface abstracts MongoDB/SQLite/ES

---

## Proto Design

### File Structure

```
apis/ai/stigmer/search/v1/
├── query.proto          # SearchQueryController service
└── io.proto             # Request/Response messages
```

### query.proto

```protobuf
syntax = "proto3";

package ai.stigmer.search.v1;

import "ai/stigmer/search/v1/io.proto";
import "ai/stigmer/commons/apiresource/rpc_service_options.proto";
import "ai/stigmer/iam/iampolicy/v1/rpcauthorization/method_options.proto";

// SearchQueryController provides unified search across all API resources.
//
// Single RPC that handles all search use cases:
// - List agents:    {kinds: [AGENT], org: "acme", query: ""}
// - Search agents:  {kinds: [AGENT], query: "security"}
// - Discover all:   {kinds: [], query: "kubernetes"}
//
// Authorization: Returns only resources the caller has can_view permission on.
// Implementation: FGA call → get authorized IDs → query with filters.
service SearchQueryController {
  
  // Search resources by kind(s).
  //
  // Behavior:
  // - kinds provided: Search only those resource types
  // - kinds empty: Search all resource types (discover mode)
  // - org provided: Scope search to that organization
  // - org empty: Search all resources caller has access to
  // - query empty: Return all accessible resources (list mode)
  // - query provided: Full-text search on name, description, tags
  //
  // Authorization is handled in the handler:
  // 1. Call FGA to get authorized resource IDs per kind
  // 2. Apply additional filters (org, query, exclude_public)
  // 3. Return paginated results sorted by relevance (or created_at if no query)
  rpc search(SearchRequest) returns (SearchResponse) {
    option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.is_skip_authorization) = true;
  }
}
```

### io.proto

```protobuf
syntax = "proto3";

package ai.stigmer.search.v1;

import "ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto";
import "ai/stigmer/commons/apiresource/enum.proto";
import "ai/stigmer/commons/rpc/pagination.proto";
import "buf/validate/validate.proto";
import "google/protobuf/timestamp.proto";

// ============================================
// Request
// ============================================

message SearchRequest {
  // Resource kinds to search.
  // - Empty: Search all kinds (discover mode)
  // - Single kind: Search that resource type only (e.g., [AGENT])
  // - Multiple kinds: Search specified types (e.g., [AGENT, SKILL])
  repeated ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind kinds = 1;
  
  // Search query (searches name, description, tags).
  // Empty query returns all accessible resources (acts as "list").
  string query = 2;
  
  // Organization scope (optional).
  // - Provided: Search only within this org (caller must have access)
  // - Empty: Search all resources caller has access to
  string org = 3;
  
  // Exclude public/platform resources from results.
  // Default: false (include public resources).
  // When true: Only return resources from orgs the caller is a member of.
  bool exclude_public = 4;
  
  // Pagination
  ai.stigmer.commons.rpc.PageInfo page = 5;
}

// ============================================
// Response
// ============================================

message SearchResponse {
  // Search results, sorted by relevance (or created_at DESC if no query).
  repeated SearchResult entries = 1;
  
  // Count of results per kind (useful for UI tabs/filters).
  // e.g., {"AGENT": 5, "SKILL": 12, "MCP_SERVER": 3, "WORKFLOW": 2}
  map<string, int32> counts_by_kind = 2;
  
  // Total count across all kinds.
  int32 total_count = 3;
  
  // Total pages for pagination.
  int32 total_pages = 4;
}

// ============================================
// Search Result (Display Attributes Only)
// ============================================

message SearchResult {
  // Resource kind
  ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind kind = 1;
  
  // Resource identifier (system-generated UUID)
  string id = 2;
  
  // Human-readable name
  string name = 3;
  
  // URL-friendly identifier (unique within org)
  string slug = 4;
  
  // Qualified slug: "org/slug" (e.g., "stigmer/web-search")
  string qualified_slug = 5;
  
  // Organization that owns this resource
  string org = 6;
  
  // Brief description (may be truncated for display)
  string description = 7;
  
  // Visibility: PUBLIC or PRIVATE
  ai.stigmer.commons.apiresource.ApiResourceVisibility visibility = 8;
  
  // Tags for categorization
  repeated string tags = 9;
  
  // When the resource was created
  google.protobuf.Timestamp created_at = 10;
  
  // When the resource was last updated
  google.protobuf.Timestamp updated_at = 11;
  
  // Relevance score (0.0-1.0). Higher = better match.
  // When query is empty, all results have score 1.0.
  float score = 12;
}
```

---

## CLI Command Mapping

| CLI Command | RPC Request |
|-------------|-------------|
| `stigmer agent list` | `{kinds: [AGENT], org: "<user's org>", query: ""}` |
| `stigmer agent list --org stigmer` | `{kinds: [AGENT], org: "stigmer", query: ""}` |
| `stigmer agent search "code review"` | `{kinds: [AGENT], query: "code review"}` |
| `stigmer agent search "code review" --org stigmer` | `{kinds: [AGENT], query: "code review", org: "stigmer"}` |
| `stigmer skill list` | `{kinds: [SKILL], org: "<user's org>", query: ""}` |
| `stigmer skill search "security"` | `{kinds: [SKILL], query: "security"}` |
| `stigmer mcpserver list` | `{kinds: [MCP_SERVER], org: "<user's org>", query: ""}` |
| `stigmer workflow list` | `{kinds: [WORKFLOW], org: "<user's org>", query: ""}` |
| `stigmer discover "kubernetes"` | `{kinds: [], query: "kubernetes"}` |
| `stigmer discover "kubernetes" --type agent,skill` | `{kinds: [AGENT, SKILL], query: "kubernetes"}` |
| `stigmer discover "kubernetes" --exclude-public` | `{kinds: [], query: "kubernetes", exclude_public: true}` |

---

## Backend Architecture

### Directory Structure

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/
└── search/                              # Search Bounded Context
    ├── request/
    │   ├── controller/
    │   │   └── SearchGrpcAutoController.java
    │   └── handler/
    │       └── SearchHandler.java       # Single handler for search RPC
    ├── repo/
    │   ├── SearchRepository.java        # Interface
    │   └── MongoSearchRepository.java   # MongoDB implementation
    └── model/
        └── SearchableResource.java      # Domain model for searchable fields
```

### Handler Flow

```
SearchHandler
│
├── 1. Validate Request
│   └── Validate kinds enum values, pagination bounds
│
├── 2. Resolve Authorized IDs (per kind)
│   ├── For each kind in request (or all if empty):
│   │   └── Call FGA: listAuthorizedResourceIds(caller, kind, can_view)
│   └── Result: Map<Kind, List<String>> authorizedIdsByKind
│
├── 3. Build Query Filters
│   ├── Base: resource_id IN authorizedIdsByKind[kind]
│   ├── If org provided: AND metadata.org = org
│   ├── If exclude_public: AND metadata.visibility != PUBLIC
│   └── If query provided: AND $text matches query
│
├── 4. Execute Search (via SearchRepository)
│   ├── MongoDB: db.collection.find({...}).sort({score: -1})
│   └── (Future) Elasticsearch: index.search({...})
│
├── 5. Map to SearchResult
│   └── Extract display attributes only (name, slug, org, description, tags, timestamps)
│
└── 6. Build Response
    ├── entries: List<SearchResult>
    ├── counts_by_kind: aggregated counts
    ├── total_count, total_pages
    └── Return SearchResponse
```

### Repository Interface

```java
/**
 * Search repository interface - data layer abstraction.
 * 
 * Implementations:
 * - MongoSearchRepository: Uses MongoDB text indexes (MVP)
 * - SqliteSearchRepository: Uses SQLite FTS5 (OSS/Local)
 * - (Future) ElasticSearchRepository: Full Elasticsearch
 */
public interface SearchRepository {
    
    /**
     * Search resources with text query and authorization filter.
     *
     * @param kinds Resource kinds to search (empty = all)
     * @param query Search query (empty = return all)
     * @param authorizedIdsByKind Map of kind -> authorized IDs from FGA
     * @param orgFilter Optional org scope
     * @param excludePublic Whether to exclude public resources
     * @param page Pagination
     * @return Paginated search results with scores
     */
    SearchResult search(
        List<ApiResourceKind> kinds,
        String query,
        Map<ApiResourceKind, List<String>> authorizedIdsByKind,
        Optional<String> orgFilter,
        boolean excludePublic,
        PageInfo page
    );
}
```

### MongoDB Text Index Setup

```javascript
// Create text indexes on each collection
db.agents.createIndex({
  "metadata.name": "text",
  "metadata.description": "text", 
  "metadata.tags": "text"
}, {
  weights: { "metadata.name": 10, "metadata.description": 5, "metadata.tags": 3 },
  name: "search_text_index"
});

// Same for skills, mcp_servers, workflows
```

---

## Implementation Phases

### Phase 1: Proto & Stubs (Day 1)
- [ ] Create `apis/ai/stigmer/search/v1/query.proto`
- [ ] Create `apis/ai/stigmer/search/v1/io.proto`
- [ ] Generate stubs (Go, Java, Python, TypeScript)
- [ ] Verify proto compilation

### Phase 2: Backend Handler (Days 2-3)
- [ ] Create `SearchRepository` interface
- [ ] Implement `MongoSearchRepository`
- [ ] Create `SearchHandler` with pipeline steps:
  - ValidateRequest
  - ResolveAuthorizedIds (FGA integration)
  - ExecuteSearch
  - MapToSearchResult
  - BuildResponse
- [ ] Create MongoDB text indexes

### Phase 3: CLI Integration (Days 4-5)
- [ ] Add `list` subcommand to agent, skill, mcpserver, workflow
- [ ] Add `search` subcommand to agent, skill, mcpserver, workflow
- [ ] Add root `discover` command
- [ ] Wire to SearchQueryController gRPC client

### Phase 4: Testing & Polish (Days 6-7)
- [ ] Unit tests for SearchHandler
- [ ] Unit tests for MongoSearchRepository
- [ ] Integration tests for end-to-end flow
- [ ] CLI output formatting and UX polish

---

## Success Criteria

| Criterion | Validation |
|-----------|------------|
| Proto compiles | `make protos` succeeds |
| Stubs generated | Go, Java, Python, TS files present |
| Backend handler works | `grpcurl` returns results |
| `stigmer agent list` works | Returns agents in user's org |
| `stigmer agent search "X"` works | Returns matching agents |
| `stigmer discover "X"` works | Returns results across all kinds |
| FGA integration | Only authorized resources returned |
| Pagination works | `--page` and `--page-size` flags work |

---

## Open Questions (For Review)

1. **Description field**: `ApiResourceMetadata` doesn't have `description`. Should we:
   - (A) Add `description` to `ApiResourceMetadata` 
   - (B) Pull from `spec.description` or `spec.instructions` per resource type
   - (C) Skip description in search results for MVP

2. **Sort order when no query**: Should list results be sorted by:
   - (A) `created_at DESC` (newest first)
   - (B) `updated_at DESC` (recently modified first)
   - (C) `name ASC` (alphabetical)

3. **Search result truncation**: Should `description` in results be:
   - (A) Full description
   - (B) Truncated to N characters (e.g., 200)
   - (C) First sentence only

---

## Review Checklist

Please confirm:

- [ ] Single `search` RPC design is correct
- [ ] `SearchResult` display attributes are sufficient
- [ ] `exclude_public` (default false) is the right approach
- [ ] Backend handler flow makes sense
- [ ] CLI command mapping is accurate
- [ ] Phase breakdown and timeline is realistic

**Please provide feedback on the open questions and any other concerns.**
