# Task T01: Unified Search API - Revised Plan

**Created**: 2026-02-01
**Revised**: 2026-02-01 (incorporated review feedback)
**Revised**: 2026-02-01 (DDD architecture review - CQRS alignment)
**Status**: APPROVED
**Type**: Feature Development
**Timeline**: 1 week

---

## Executive Summary

Implement a **Search Query Service** (CQRS read-side) with a single `search` RPC that handles all resource discovery operations:
- **List**: `{kinds: [AGENT], org: "acme", query: ""}` → List agents in "acme" org
- **Search**: `{kinds: [AGENT], query: "security"}` → Search agents matching "security"
- **Discover**: `{kinds: [], query: "kubernetes"}` → Discover all resources matching "kubernetes"

> **Architecture Note**: Search is a cross-aggregate query operation, not a domain bounded context.
> It lives in the **query layer** (CQRS read-side), not the domain layer.

---

## Design Decisions (From Review)

| Decision | Resolution |
|----------|------------|
| Description field | Extract from `spec` per resource type (optional - some may not have it) |
| Sort order (no query) | `created_at DESC` (newer first) |
| Sort order (with query) | Relevance score DESC |

---

## Proto Design

### File Structure

```
apis/ai/stigmer/search/v1/
├── query.proto          # SearchService gRPC definition
└── io.proto             # Request/Response messages
```

### query.proto

```protobuf
syntax = "proto3";

package ai.stigmer.search.v1;

import "ai/stigmer/search/v1/io.proto";
import "ai/stigmer/commons/apiresource/rpc_service_options.proto";
import "ai/stigmer/iam/iampolicy/v1/rpcauthorization/method_options.proto";

// SearchService provides unified search across all API resources.
//
// This is a CQRS Query Service - it reads from multiple aggregates
// and returns display-optimized projections. It does not modify state.
//
// Single RPC that handles all search use cases:
// - List agents:    {kinds: [AGENT], org: "acme", query: ""}
// - Search agents:  {kinds: [AGENT], query: "security"}
// - Discover all:   {kinds: [], query: "kubernetes"}
//
// Authorization: Returns only resources the caller has can_view permission on.
// Implementation: FGA call → get authorized IDs → query with filters.
service SearchService {
  
  // Search resources by kind(s).
  //
  // Behavior:
  // - kinds provided: Search only those resource types
  // - kinds empty: Search all resource types (discover mode)
  // - org provided: Scope search to that organization
  // - org empty: Search all resources caller has access to
  // - query empty: Return all accessible resources (list mode), sorted by created_at DESC
  // - query provided: Full-text search on name, description, tags, sorted by relevance
  //
  // Authorization is handled at the application layer:
  // 1. Call FGA to get authorized resource IDs per kind
  // 2. Apply additional filters (org, query, exclude_public)
  // 3. Return paginated results
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
  // Empty query returns all accessible resources (list mode).
  // - With query: Results sorted by relevance score DESC
  // - Without query: Results sorted by created_at DESC (newer first)
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
  // Search results.
  // - With query: Sorted by relevance score DESC
  // - Without query: Sorted by created_at DESC (newer first)
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
  
  // Human-readable name (from metadata.name)
  string name = 3;
  
  // URL-friendly identifier (from metadata.slug, unique within org)
  string slug = 4;
  
  // Qualified slug: "org/slug" (e.g., "stigmer/web-search")
  // Computed field for CLI display
  string qualified_slug = 5;
  
  // Organization that owns this resource (from metadata.org)
  string org = 6;
  
  // Brief description (extracted from spec per resource type).
  // Optional - some resources may not have a description.
  // - Agent: spec.instructions (truncated) or spec.description
  // - Skill: spec.description
  // - McpServer: spec.description
  // - Workflow: spec.description
  string description = 7;
  
  // Visibility: PUBLIC or PRIVATE (from metadata.visibility)
  ai.stigmer.commons.apiresource.ApiResourceVisibility visibility = 8;
  
  // Tags for categorization (from metadata.tags)
  repeated string tags = 9;
  
  // When the resource was created (from status.audit.created_at)
  google.protobuf.Timestamp created_at = 10;
  
  // When the resource was last updated (from status.audit.updated_at)
  google.protobuf.Timestamp updated_at = 11;
  
  // Relevance score (0.0-1.0). Higher = better match.
  // - With query: Score from text search ranking
  // - Without query: Always 1.0
  float score = 12;
}
```

---

## CLI Command Mapping

All CLI commands call `SearchService.search()` RPC with different parameters:

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

### Architectural Decision: CQRS Query Layer

Search is a **cross-aggregate read operation** - it queries multiple domain aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized projections. This is not domain logic; it's query infrastructure.

**Placement**: `query/` package (not `domain/`)

**Rationale**:
- No business invariants to protect
- No state mutations
- Crosses bounded context boundaries
- Returns DTOs, not domain entities

### Directory Structure

```
backend/services/stigmer-service/src/main/java/ai/stigmer/
├── domain/                              # Domain Layer (Aggregates, Entities, Value Objects)
│   ├── agent/                           # Agent aggregate
│   ├── skill/                           # Skill aggregate
│   ├── mcpserver/                       # McpServer aggregate
│   └── workflow/                        # Workflow aggregate
│
└── query/                               # CQRS Read Side (Query Services)
    └── search/
        ├── SearchGrpcService.java       # gRPC endpoint (thin adapter)
        ├── SearchQueryHandler.java      # Query orchestration
        ├── SearchQueryStore.java        # Interface for search queries
        ├── MongoSearchQueryStore.java   # MongoDB implementation
        └── dto/
            └── SearchResultDto.java     # Explicit DTO (not domain object)
```

### Query Handler Flow

```
SearchQueryHandler (Application Layer - Query Side)
│
├── 1. Validate & Parse Request
│   └── Create SearchCriteria value object (validates kinds, pagination bounds)
│
├── 2. Determine Kinds to Search
│   └── If kinds empty → use all searchable kinds [AGENT, SKILL, MCP_SERVER, WORKFLOW]
│
├── 3. Resolve Authorized IDs (per kind) [Application Concern]
│   ├── For each kind:
│   │   └── Call FGA: listAuthorizedResourceIds(caller, kind, can_view)
│   └── Result: AuthorizedResourceIds value object
│
├── 4. Execute Search (via SearchQueryStore)
│   ├── For each kind with authorized IDs:
│   │   ├── Base filter: _id IN authorizedIds
│   │   ├── If org provided: AND metadata.org = org
│   │   ├── If exclude_public: AND metadata.visibility != PUBLIC
│   │   ├── If query provided: AND $text matches query
│   │   └── Sort: score DESC (with query) or created_at DESC (without query)
│   └── Aggregate results across kinds
│
├── 5. Build DTOs
│   └── SearchQueryStore returns SearchResultDto directly (projection query)
│
└── 6. Build Response
    ├── results: List<SearchResultDto>
    ├── counts_by_kind: aggregated counts
    ├── total_count, total_pages
    └── Return SearchResponse
```

### Domain Interface: Searchable (Polymorphic Projection)

Each domain aggregate implements a `Searchable` interface, owning its own searchable representation.
This avoids type-switching in external mappers (Open-Closed Principle).

```java
// In domain layer - each aggregate implements this
public interface Searchable {
    
    /**
     * Returns the display summary for search results.
     * Each aggregate defines its own summary logic.
     * 
     * Note: Truncation for display is a PRESENTATION concern.
     * This method returns the full summary; the UI/CLI truncates as needed.
     */
    String getSearchSummary();
    
    /**
     * Returns combined searchable text for indexing.
     * Used by MongoDB text index.
     */
    String getSearchableText();
    
    /**
     * Returns metadata needed for search result display.
     */
    SearchableMetadata getSearchableMetadata();
}

public record SearchableMetadata(
    ApiResourceKind kind,
    String id,
    String name,
    String slug,
    String org,
    ApiResourceVisibility visibility,
    List<String> tags,
    Instant createdAt,
    Instant updatedAt
) {
    public String qualifiedSlug() {
        return org + "/" + slug;
    }
}
```

### Agent Implementation Example

```java
// In domain/agent/Agent.java
public class Agent implements Searchable {
    
    @Override
    public String getSearchSummary() {
        // Agent's business rule: summary comes from instructions
        return spec.getInstructions();  // Full text - no truncation here
    }
    
    @Override
    public String getSearchableText() {
        // Combine fields for text search indexing
        return String.join(" ", 
            metadata.getName(),
            spec.getInstructions(),
            String.join(" ", metadata.getTags())
        );
    }
    
    @Override
    public SearchableMetadata getSearchableMetadata() {
        return new SearchableMetadata(
            ApiResourceKind.AGENT,
            metadata.getId(),
            metadata.getName(),
            metadata.getSlug(),
            metadata.getOrg(),
            metadata.getVisibility(),
            metadata.getTags(),
            status.getAudit().getCreatedAt(),
            status.getAudit().getUpdatedAt()
        );
    }
}
```

### Query Store: Direct Projection (No Mapper Needed)

Instead of loading full aggregates and mapping, use **projection queries** that build DTOs directly:

```java
// In query/search/MongoSearchQueryStore.java
public class MongoSearchQueryStore implements SearchQueryStore {
    
    /**
     * Query returns SearchResultDto directly via MongoDB projection.
     * No intermediate domain objects - pure read optimization.
     */
    @Override
    public SearchPagedResult search(SearchCriteria criteria, AuthorizedResourceIds authorized) {
        // MongoDB aggregation pipeline with $project stage
        // Returns exactly the fields needed for SearchResultDto
        var pipeline = List.of(
            Aggregates.match(buildFilters(criteria, authorized)),
            Aggregates.project(buildProjection()),  // Only fetch display fields
            Aggregates.sort(buildSort(criteria)),
            Aggregates.facet(
                new Facet("results", skip, limit),
                new Facet("totalCount", Aggregates.count())
            )
        );
        // ... execute and return
    }
    
    private Bson buildProjection() {
        // Project directly to DTO shape
        return Projections.fields(
            Projections.include(
                "_id",
                "metadata.name",
                "metadata.slug", 
                "metadata.org",
                "metadata.visibility",
                "metadata.tags",
                "spec.instructions",  // For agents
                "spec.description",   // For skills, mcpservers, workflows
                "status.audit.created_at",
                "status.audit.updated_at"
            ),
            Projections.metaTextScore("score")
        );
    }
}
```

### Presentation Layer Truncation

Truncation belongs in the **presentation layer** (CLI, Web UI), not the query layer:

```go
// In CLI: client-apps/cli/internal/display/truncate.go
func TruncateDescription(desc string, maxLen int) string {
    if len(desc) <= maxLen {
        return desc
    }
    return desc[:maxLen] + "..."
}

// Usage in table formatter
fmt.Fprintf(w, "%s\t%s\n", result.Name, TruncateDescription(result.Description, 60))
```

### Query Store Interface (with Value Objects)

```java
/**
 * SearchQueryStore - Query-side data access for search operations.
 * 
 * Note: This is NOT a DDD Repository. Repositories work with Aggregates.
 * This is a Query Store that returns DTOs for read operations.
 */
public interface SearchQueryStore {
    
    /**
     * Search resources with text query and authorization filter.
     * Returns DTOs directly (projection query), not domain objects.
     */
    SearchPagedResult search(SearchCriteria criteria, AuthorizedResourceIds authorized);
}

/**
 * Value Object: Encapsulates search criteria with validation.
 */
public record SearchCriteria(
    Set<ApiResourceKind> kinds,
    SearchQuery query,
    OrganizationId orgFilter,
    boolean excludePublic,
    PageInfo page
) {
    public SearchCriteria {
        // Immutable - validate on construction
        kinds = kinds == null ? Set.of() : Set.copyOf(kinds);
        query = query == null ? SearchQuery.empty() : query;
        // orgFilter can be null (search all orgs)
    }
    
    public boolean isDiscoverMode() {
        return kinds.isEmpty();
    }
    
    public boolean hasQuery() {
        return !query.isEmpty();
    }
    
    public Set<ApiResourceKind> effectiveKinds() {
        return kinds.isEmpty() 
            ? Set.of(AGENT, SKILL, MCP_SERVER, WORKFLOW)  // All searchable kinds
            : kinds;
    }
}

/**
 * Value Object: Search query with validation and normalization.
 */
public record SearchQuery(String value) {
    
    private static final int MAX_LENGTH = 500;
    private static final SearchQuery EMPTY = new SearchQuery("");
    
    public SearchQuery {
        value = value == null ? "" : value.strip();
        if (value.length() > MAX_LENGTH) {
            throw new IllegalArgumentException(
                "Search query exceeds maximum length of " + MAX_LENGTH
            );
        }
    }
    
    public static SearchQuery empty() { return EMPTY; }
    public static SearchQuery of(String value) { return new SearchQuery(value); }
    
    public boolean isEmpty() { return value.isEmpty(); }
}

/**
 * Value Object: Authorized resource IDs per kind.
 */
public record AuthorizedResourceIds(
    Map<ApiResourceKind, Set<String>> idsByKind
) {
    public AuthorizedResourceIds {
        idsByKind = Map.copyOf(idsByKind);  // Immutable
    }
    
    public Set<String> getIds(ApiResourceKind kind) {
        return idsByKind.getOrDefault(kind, Set.of());
    }
    
    public boolean hasAccessTo(ApiResourceKind kind) {
        return !getIds(kind).isEmpty();
    }
}
```

### MongoDB Text Index Setup

```javascript
// Create text indexes on each collection
db.agents.createIndex({
  "metadata.name": "text",
  "spec.instructions": "text", 
  "metadata.tags": "text"
}, {
  weights: { "metadata.name": 10, "spec.instructions": 3, "metadata.tags": 5 },
  name: "search_text_index"
});

db.skills.createIndex({
  "metadata.name": "text",
  "spec.description": "text", 
  "metadata.tags": "text"
}, {
  weights: { "metadata.name": 10, "spec.description": 5, "metadata.tags": 5 },
  name: "search_text_index"
});

// Similar for mcp_servers, workflows
```

---

## Implementation Phases

### Phase 1: Proto & Stubs (Day 1)
- [ ] Create `apis/ai/stigmer/search/v1/query.proto` (with `SearchService` name)
- [ ] Create `apis/ai/stigmer/search/v1/io.proto`
- [ ] Add to `buf.yaml` modules
- [ ] Generate stubs (Go, Java, Python, TypeScript)
- [ ] Verify proto compilation with `make protos`

### Phase 2: Domain Interface & Value Objects (Day 2)
- [ ] Create `Searchable` interface in `domain/shared/`
- [ ] Create `SearchableMetadata` record
- [ ] Create value objects: `SearchCriteria`, `SearchQuery`, `AuthorizedResourceIds`
- [ ] Implement `Searchable` in Agent aggregate
- [ ] Implement `Searchable` in Skill aggregate
- [ ] Implement `Searchable` in McpServer aggregate
- [ ] Implement `Searchable` in Workflow aggregate

### Phase 3: Query Layer (Days 3-4)
- [ ] Create `SearchQueryStore` interface in `query/search/`
- [ ] Create `SearchResultDto` in `query/search/dto/`
- [ ] Implement `MongoSearchQueryStore` with projection queries
- [ ] Create `SearchQueryHandler` with pipeline steps
- [ ] Create `SearchGrpcService` gRPC adapter
- [ ] Create MongoDB text indexes (migration script)
- [ ] Wire up in Spring configuration

### Phase 4: CLI Integration (Days 5-6)
- [ ] Create gRPC client wrapper for SearchService
- [ ] Create `truncate.go` for presentation-layer truncation
- [ ] Add `list` subcommand to: agent, skill, mcpserver, workflow
- [ ] Add `search` subcommand to: agent, skill, mcpserver, workflow
- [ ] Add root `discover` command
- [ ] Implement table output formatting

### Phase 5: Testing & Polish (Day 7)
- [ ] Unit tests for value objects (SearchQuery, SearchCriteria)
- [ ] Unit tests for SearchQueryHandler
- [ ] Unit tests for MongoSearchQueryStore
- [ ] Unit tests for Searchable implementations
- [ ] Integration tests for end-to-end flow
- [ ] CLI output formatting and UX polish
- [ ] Documentation updates

---

## Success Criteria

| Criterion | Validation |
|-----------|------------|
| Proto compiles | `make protos` succeeds |
| Stubs generated | Go, Java, Python, TS files present |
| Query handler works | `grpcurl` to SearchService returns results |
| `stigmer agent list` works | Returns agents in user's org, sorted by created_at DESC |
| `stigmer agent search "X"` works | Returns matching agents, sorted by relevance |
| `stigmer discover "X"` works | Returns results across all kinds |
| FGA integration | Only authorized resources returned |
| Pagination works | `--page` and `--page-size` flags work |
| Description from Searchable | Each aggregate provides its own summary via `getSearchSummary()` |
| CLI truncation | Description truncated in CLI display (presentation layer) |
| Value object validation | Invalid SearchQuery throws on construction |

---

## Files to Create/Modify

### New Files - API Layer
| File | Description |
|------|-------------|
| `apis/ai/stigmer/search/v1/query.proto` | SearchService gRPC service definition |
| `apis/ai/stigmer/search/v1/io.proto` | Request/Response messages |

### New Files - Query Layer (CQRS Read Side)
| File | Description |
|------|-------------|
| `backend/.../query/search/SearchGrpcService.java` | gRPC adapter (thin) |
| `backend/.../query/search/SearchQueryHandler.java` | Query orchestration |
| `backend/.../query/search/SearchQueryStore.java` | Query store interface |
| `backend/.../query/search/MongoSearchQueryStore.java` | MongoDB implementation |
| `backend/.../query/search/dto/SearchResultDto.java` | Search result DTO |
| `backend/.../query/search/valueobject/SearchCriteria.java` | Search criteria value object |
| `backend/.../query/search/valueobject/SearchQuery.java` | Query string value object |
| `backend/.../query/search/valueobject/AuthorizedResourceIds.java` | Auth IDs value object |

### New Files - Domain Layer (Interface)
| File | Description |
|------|-------------|
| `backend/.../domain/shared/Searchable.java` | Interface for searchable aggregates |
| `backend/.../domain/shared/SearchableMetadata.java` | Metadata record for search |

### New Files - CLI
| File | Description |
|------|-------------|
| `client-apps/cli/internal/cli/search/client.go` | gRPC client wrapper |
| `client-apps/cli/internal/display/truncate.go` | Presentation-layer truncation |
| `client-apps/cli/cmd/stigmer/root/discover.go` | discover command |

### Modified Files - Domain Aggregates
| File | Change |
|------|--------|
| `backend/.../domain/agent/Agent.java` | Implement `Searchable` interface |
| `backend/.../domain/skill/Skill.java` | Implement `Searchable` interface |
| `backend/.../domain/mcpserver/McpServer.java` | Implement `Searchable` interface |
| `backend/.../domain/workflow/Workflow.java` | Implement `Searchable` interface |

### Modified Files - Other
| File | Change |
|------|--------|
| `apis/buf.yaml` | Add search module |
| `client-apps/cli/cmd/stigmer/root/agent.go` | Add list, search subcommands |
| `client-apps/cli/cmd/stigmer/root/skill.go` | Add list, search subcommands |
| `client-apps/cli/cmd/stigmer/root/mcpserver.go` | Add list, search subcommands |
| `client-apps/cli/cmd/stigmer/root/workflow.go` | Add list, search subcommands |

---

## Architectural Decisions Record (ADR)

### ADR-1: Search as CQRS Query Layer, Not Domain

**Decision**: Place search implementation in `query/search/` not `domain/search/`.

**Context**: Search is a cross-aggregate read operation that queries multiple bounded contexts (Agent, Skill, McpServer, Workflow) and returns display-optimized projections.

**Consequences**:
- Clear separation: `domain/` contains business logic with invariants; `query/` contains read-optimized projections
- No pretense of being a "bounded context" - it's infrastructure
- Freedom to optimize reads without domain constraints

### ADR-2: Searchable Interface on Domain Aggregates

**Decision**: Each domain aggregate implements `Searchable` interface rather than external mapper with type-switching.

**Context**: Different resources have descriptions in different places (Agent uses `spec.instructions`, others use `spec.description`). External mappers would require `switch` on type.

**Consequences**:
- Open-Closed Principle: Adding new searchable resource requires only implementing the interface
- Each aggregate owns its searchable representation (polymorphism)
- No centralized mapper that grows with each new type

### ADR-3: Value Objects for Type Safety

**Decision**: Use `SearchQuery`, `SearchCriteria`, `AuthorizedResourceIds` as value objects.

**Context**: Primitive types (`String query`, `Map<Kind, List<String>>`) allow invalid states.

**Consequences**:
- Invalid states unrepresentable at compile time
- Validation happens once at construction
- Self-documenting code with explicit types

### ADR-4: Presentation-Layer Truncation

**Decision**: Description truncation happens in CLI/UI, not in query layer.

**Context**: The 200-character truncation with "..." is a display concern, not business logic.

**Consequences**:
- Query layer returns full data; presentation decides how to display
- Different UIs can truncate differently (CLI: 60 chars, Web: 200 chars)
- Clear separation of concerns

---

## Approval

This plan has been reviewed and DDD architecture feedback incorporated.

**Changes from previous revision**:
1. Renamed from "Search Bounded Context" to "Search Query Service"
2. Moved from `domain/search/` to `query/search/`
3. Added `Searchable` interface for polymorphic projections
4. Added value objects for type safety
5. Moved truncation logic to presentation layer
6. Renamed `SearchQueryController` to `SearchService`
7. Renamed `SearchRepository` to `SearchQueryStore`
8. Added explicit DTO layer (`SearchResultDto`)

**Ready for execution.**
