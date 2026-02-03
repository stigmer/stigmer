# Unified Search API - Phase 1: Proto Definitions

**Date**: February 1, 2026

## Summary

Established the foundational API layer for the unified search service - a CQRS query service that enables list, search, and discover operations across all API resources (agents, skills, MCP servers, workflows) through a single `search` RPC. This phase delivers production-ready proto definitions with comprehensive documentation, type-safe validation, and generated stubs for Go, Java, Python, and TypeScript.

## Problem Statement

Prior to this work, the platform lacked a unified search interface. Each resource type would require separate list/search operations, leading to:
- **API proliferation**: Multiple similar RPCs across different services
- **Inconsistent patterns**: Different search behaviors for different resource types
- **Client complexity**: CLI and UI clients needed to manage multiple endpoints
- **Architectural confusion**: Unclear whether search should be per-domain or cross-cutting

### Pain Points

- No single endpoint to discover resources across the platform
- CLI commands like `stigmer agent list`, `stigmer skill search` would need separate implementations
- Search authorization (FGA integration) would be duplicated across services
- No consistent pagination or result format across resource types
- Discover mode (search across all kinds) was architecturally undefined

## Solution

Implemented a **CQRS Query Service** architecture with these key design decisions:

### 1. Single RPC, Multiple Modes

One `SearchService.search()` RPC handles three operation modes:
- **List mode**: `{kinds: [agent], org: "acme", query: ""}` → All agents in org, sorted by created_at DESC
- **Search mode**: `{kinds: [agent], query: "security"}` → Text search with relevance ranking
- **Discover mode**: `{kinds: [], query: "kubernetes"}` → Cross-kind discovery

### 2. CQRS Query Layer Positioning

Explicitly positioned search as **query infrastructure**, not a domain bounded context:
- Lives in `query/` layer (read-side), not `domain/` layer
- No `api_resource_kind` service option (not an API resource itself)
- Authorization handled programmatically via FGA (not declarative options)
- Returns display projections (DTOs), not full domain entities

### 3. Type-Safe, Validated Design

- Uses `ApiResourceKind` enum (not strings) for type safety
- `buf.validate` rules for query length (max 500), org pattern, enum validation
- Pattern-based validation: `^$|^[a-z][a-z0-9-]*$` for org slugs

### 4. Display-Optimized Response

`SearchResult` contains exactly what UIs need:
- Identity fields: `kind`, `id`, `slug`, `qualified_slug`, `org`
- Display fields: `name`, `description`, `tags`
- Metadata: `visibility`, `created_at`, `updated_at`, `score`
- **NOT** the full resource (use kind-specific QueryController for that)

## Implementation Details

### File Structure

```
apis/ai/stigmer/search/v1/
├── query.proto    # SearchService gRPC definition
└── io.proto       # Request/Response messages
```

### Proto Design Highlights

#### query.proto (61 lines)

```protobuf
service SearchService {
  rpc search(SearchRequest) returns (SearchResponse) {
    option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.is_skip_authorization) = true;
  }
}
```

**Key aspects:**
- Comprehensive service-level documentation explaining CQRS architecture
- Behavior table documenting all operation modes
- `is_skip_authorization = true` with explanation of in-handler FGA authorization
- Clear distinction from domain services (no `api_resource_kind` option)

#### io.proto (243 lines)

Three message types with extensive documentation:

**SearchRequest**:
- `repeated ApiResourceKind kinds` - Type-safe resource filtering
- `string query` - Full-text search (max 500 chars)
- `string org` - Organization scope with pattern validation
- `bool exclude_public` - Smart default (false = include public)
- `PageInfo page` - Standard pagination

**SearchResponse**:
- `repeated SearchResult entries` - Current page results
- `map<string, int32> counts_by_kind` - For UI tabs/filters
- `int32 total_count`, `int32 total_pages` - Pagination metadata

**SearchResult** (12 fields):
- All fields documented with source (e.g., "From metadata.name")
- Description extraction documented per resource type (Agent vs Skill vs McpServer)
- Pre-computed `qualified_slug` for CLI display
- Relevance `score` (0.0-1.0) for ranking

### Documentation Quality

Every element has comprehensive documentation:
- **Service level**: Purpose, architecture, authorization model, usage patterns
- **RPC level**: Behavior table, sort order rules, pagination guidance
- **Message level**: Use cases, examples in multiple formats
- **Field level**: Format, validation rules, examples, defaults

Example field documentation:
```protobuf
// Organization to scope the search.
//
// Format: lowercase alphanumeric with hyphens (e.g., "acme", "stigmer").
//
// Behavior:
// - Empty: Search all organizations the caller has access to
// - Non-empty: Search only within the specified organization
//   Caller must have access to at least one resource in the org
//
// Examples: "stigmer", "acme-corp", "my-org"
string org = 3 [
  (buf.validate.field).string.max_len = 63,
  (buf.validate.field).string.pattern = "^$|^[a-z][a-z0-9-]*$"
];
```

### Validation Rules

| Field | Validation | Rationale |
|-------|------------|-----------|
| `query` | Max 500 chars | Prevent abuse, reasonable search length |
| `org` | Pattern `^$\|^[a-z][a-z0-9-]*$` | Allow empty OR valid slug format |
| `kinds` | `defined_only = true` | Only valid enum values |
| `exclude_public` | Boolean | Proto3 default false = sensible behavior |

### Generated Stubs

Successfully generated stubs for all target languages:

**Go** (`stubs/go/ai/stigmer/search/v1/`):
- `query.pb.go` - Message types
- `query_grpc.pb.go` - gRPC service client/server
- `io.pb.go` - Request/Response types
- `BUILD.bazel` - Bazel build configuration

**Python** (`stubs/python/stigmer/ai/stigmer/search/v1/`):
- `query_pb2.py` - Proto messages
- `query_pb2_grpc.py` - gRPC service stubs
- `io_pb2.py` - I/O messages
- `.pyi` type stubs for all modules

**Java & TypeScript**: Generated via buf plugins

### Compilation Verification

✅ All verification checks passed:
- `buf lint` - No warnings
- `buf format` - Auto-formatted (import ordering)
- `go build ./...` - Go stubs compile successfully
- Service documentation renders correctly in generated code

### Architectural Decisions Documented in Proto

The proto itself serves as architectural documentation:

```protobuf
// Architectural Note:
// Search is cross-aggregate query infrastructure, not a domain bounded context.
// It lives in the query layer (CQRS read-side), not the domain layer.
// Therefore, it does not have an api_resource_kind option like domain services.
//
// Authorization Model:
// Unlike domain services that use declarative authorization options,
// SearchService handles authorization programmatically in the handler:
// 1. Call FGA to get authorized resource IDs per requested kind
// 2. Apply filters (org, query, exclude_public) against authorized set
// 3. Return only resources the caller has can_view permission on
```

This prevents future confusion about service placement and authorization patterns.

## Benefits

### 1. API Consistency

- Single RPC pattern for all list/search/discover operations
- Consistent pagination across resource types
- Uniform authorization model (FGA per kind)
- Standard result format with `counts_by_kind` for UI

### 2. Developer Experience

**Generated stub quality**:
- Service documentation appears in IDE autocomplete
- Field-level comments guide proper usage
- Type safety prevents invalid requests
- Example usage patterns in proto comments

**CLI implementation simplicity**:
```go
// All these CLI commands use the same RPC:
stigmer agent list        → {kinds: [agent], org: userOrg, query: ""}
stigmer agent search "X"  → {kinds: [agent], query: "X"}
stigmer discover "X"      → {kinds: [], query: "X"}
```

### 3. Architectural Clarity

- Explicit CQRS positioning prevents domain pollution
- Clear authorization strategy (programmatic, not declarative)
- Display projection pattern established (DTOs, not domain entities)
- Separation of concerns: search is infrastructure, not domain logic

### 4. Extensibility

**Forward compatibility**:
- `kinds` array allows adding new resource types without API changes
- `exclude_public` boolean pattern can extend to other filters
- `counts_by_kind` map naturally grows with new kinds
- `SearchResult` can add fields without breaking existing clients

**Future optimization paths**:
- Can add search filters (tags, date ranges) to `SearchRequest`
- Can add aggregations to `SearchResponse`
- Can add search suggestions/autocomplete
- Can add faceted search metadata

## Impact

### Immediate Impact (Phase 1)

- **APIs**: New `ai.stigmer.search.v1` package available
- **Client stubs**: Go, Java, Python, TypeScript can import search service
- **Build**: Proto compilation integrated into `make build` workflow
- **Documentation**: Generated docs serve as implementation guide

### Upcoming Impact (Future Phases)

**Phase 2**: Backend handlers will leverage these DTOs for:
- MongoDB projection queries (no full aggregate loading)
- FGA authorization per kind
- Text index queries with relevance scoring

**Phase 3**: CLI will implement:
- `stigmer agent list` - Simple list view
- `stigmer agent search "query"` - Filtered search
- `stigmer discover "query"` - Cross-kind discovery
- Consistent table formatting with `qualified_slug`

### Affected Components

| Component | Status | Impact |
|-----------|--------|--------|
| **APIs** | ✅ Complete | New search service available |
| **Backend** | 🔜 Phase 2 | Will implement `SearchService` |
| **CLI** | 🔜 Phase 3 | Will consume search RPCs |
| **Stubs** | ✅ Generated | All languages ready |
| **Docs** | ✅ Embedded | Proto docs guide implementation |

## Related Work

### Architectural Foundation

This search API follows patterns established in:
- **Agent API** (`ai/stigmer/agentic/agent/v1/`) - Query/Command separation
- **Skill API** (`ai/stigmer/agentic/skill/v1/`) - Resource visibility model
- **Commons** (`ai/stigmer/commons/apiresource/`) - Metadata standards

### Distinctions from Domain APIs

Unlike domain APIs (Agent, Skill, etc.), this search API:
- Has no `api_resource_kind` service option
- Uses `is_skip_authorization = true` (programmatic auth)
- Returns DTOs, not full resources
- Lives conceptually in `query/` layer, not `domain/`

### Integration Points

**Depends on**:
- `ApiResourceKind` enum (defines searchable kinds)
- `ApiResourceVisibility` enum (public/private filtering)
- `PageInfo` message (pagination standard)
- FGA authorization model (can_view permission)

**Enables**:
- CLI list/search commands (Phase 3)
- Backend search handlers (Phase 2)
- Future UI search components
- Discovery workflows across resource types

### Next Steps (Phase 2)

Backend implementation will add:
1. `Searchable` interface on domain aggregates
2. `SearchQueryHandler` for orchestration
3. `SearchQueryStore` with MongoDB projections
4. FGA integration for authorization
5. Text index setup and relevance scoring

---

**Status**: ✅ Production Ready (API Contract)
**Timeline**: Phase 1 completed in 1 session (February 1, 2026)
**Next Phase**: Backend implementation (Java handlers, MongoDB, FGA)

---

## Appendix: Key Design Decisions

### Decision: Single RPC vs Multiple RPCs

**Considered**: Separate `list()`, `search()`, `discover()` RPCs

**Chose**: Single `search()` RPC with mode determined by parameters

**Rationale**:
- Reduces API surface area
- Single implementation point for auth/pagination
- Natural parameter evolution (one place to add filters)
- Simpler client code (one gRPC method to configure)

### Decision: `exclude_public` vs `include_public`

**Considered**: `bool include_public`

**Chose**: `bool exclude_public` (default false)

**Rationale**:
- Proto3 boolean defaults to `false`
- `exclude_public = false` means "include public" (sensible default)
- Users want public resources by default (discover mode)
- Opt-out pattern for privacy-conscious workflows

### Decision: Service Name `SearchService` vs `SearchQueryController`

**Considered**: `SearchQueryController` (matches domain pattern)

**Chose**: `SearchService` (infrastructure pattern)

**Rationale**:
- Explicitly signals this is NOT a domain service
- `Controller` suffix implies CRUD operations on a resource
- Search is infrastructure, not a bounded context
- Matches established query service patterns (e.g., Elasticsearch)

### Decision: No `api_resource_kind` Option

**Considered**: Adding `api_resource_kind = search`

**Chose**: Omit the option entirely

**Rationale**:
- Search is not an API resource (no metadata, spec, status)
- Would create confusion: "Can I create a Search resource?"
- FGA doesn't need it (auth is per searched kind, not per search)
- Reinforces architectural position as infrastructure

These decisions are embedded in the proto documentation for future reference.
