---
name: Phase 1 Search Protos
overview: Create the foundational proto definitions for the unified Search Query Service - a CQRS read-side service that enables list, search, and discover operations across all API resources (agents, skills, MCP servers, workflows).
todos:
  - id: create-query-proto
    content: Create apis/ai/stigmer/search/v1/query.proto with SearchService and search RPC
    status: completed
  - id: create-io-proto
    content: Create apis/ai/stigmer/search/v1/io.proto with SearchRequest, SearchResponse, SearchResult messages
    status: completed
  - id: generate-stubs
    content: Run make build to generate Go, Java, Python, TypeScript stubs
    status: completed
  - id: verify-compilation
    content: Verify proto compilation succeeds and generated stubs are correct
    status: completed
isProject: false
---

# Phase 1: Search API Proto Definitions

## Architectural Context

The Search API is fundamentally different from other bounded contexts in this codebase. It is a **CQRS Query Layer** - a cross-aggregate read service that queries multiple domain aggregates and returns display-optimized projections. This distinction is critical:


| Aspect         | Domain Bounded Context    | Search Query Service      |
| -------------- | ------------------------- | ------------------------- |
| Purpose        | Manages business entities | Cross-aggregate reads     |
| State          | Mutates state             | Read-only                 |
| Authorization  | Per-resource via options  | In-handler (FGA per kind) |
| Service Option | `api_resource_kind = X`   | None (not a resource)     |
| Location       | `domain/` layer           | `query/` layer            |


This architectural positioning influences every design decision in these protos.

---

## Files to Create

### 1. [apis/ai/stigmer/search/v1/query.proto](apis/ai/stigmer/search/v1/query.proto)

**SearchService** gRPC service definition with a single `search` RPC.

**Design Decisions:**

- **Service Name**: `SearchService` (not `SearchQueryController`) - intentional departure from domain patterns since this is infrastructure, not a domain bounded context
- **No `api_resource_kind` option**: Search is not an API resource; it's query infrastructure
- `**is_skip_authorization = true**`: Authorization is handled in-handler via FGA calls per kind, not declaratively

**Proto Structure:**

```protobuf
syntax = "proto3";

package ai.stigmer.search.v1;

import "ai/stigmer/search/v1/io.proto";
import "ai/stigmer/iam/iampolicy/v1/rpcauthorization/method_options.proto";

// SearchService provides unified search across all API resources.
//
// This is a CQRS Query Service operating on the read-side of the system.
// It queries multiple domain aggregates (Agent, Skill, McpServer, Workflow)
// and returns display-optimized projections. It does not modify state.
//
// Authorization Model:
// Unlike domain services that use declarative authorization options,
// SearchService handles authorization programmatically:
// 1. Call FGA to get authorized resource IDs per requested kind
// 2. Apply filters (org, query, exclude_public) against authorized set
// 3. Return only resources the caller can view
//
// Usage Patterns (all via single RPC):
// - List agents:    {kinds: [AGENT], org: "acme", query: ""}
// - Search agents:  {kinds: [AGENT], query: "security"}
// - Discover all:   {kinds: [], query: "kubernetes"}
service SearchService {

  // Search resources across one or more kinds.
  //
  // Unified entry point for list, search, and discover operations:
  //
  // | Operation | Request Shape |
  // |-----------|---------------|
  // | List      | kinds=[X], query="" |
  // | Search    | kinds=[X], query="..." |
  // | Discover  | kinds=[], query="..." |
  //
  // Authorization: Returns only resources caller has can_view permission on.
  // Implementation queries FGA per kind, then applies additional filters.
  rpc search(SearchRequest) returns (SearchResponse) {
    option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.is_skip_authorization) = true;
  }
}
```

---

### 2. [apis/ai/stigmer/search/v1/io.proto](apis/ai/stigmer/search/v1/io.proto)

Request/Response messages with comprehensive validation and documentation.

**Key Design Decisions:**


| Decision                                | Rationale                                                  |
| --------------------------------------- | ---------------------------------------------------------- |
| `kinds` as repeated enum                | Type-safe, discoverable, no string parsing errors          |
| `exclude_public` (not `include_public`) | Proto3 default `false` = include public (sensible default) |
| `counts_by_kind` map                    | UI can render tabs/filters without additional RPC          |
| `qualified_slug` in result              | Pre-computed `org/slug` for CLI display                    |
| `score` as float                        | Standard 0.0-1.0 relevance score                           |


**Message Structure:**

```protobuf
// SearchRequest - Input for search operations
message SearchRequest {
  // Resource kinds to search (empty = all kinds / discover mode)
  repeated ApiResourceKind kinds = 1;
  
  // Search query (empty = list mode with created_at DESC sort)
  string query = 2;
  
  // Organization scope (empty = search all accessible orgs)
  string org = 3;
  
  // Exclude public/platform resources (default false = include)
  bool exclude_public = 4;
  
  // Pagination
  PageInfo page = 5;
}

// SearchResponse - Paginated results with metadata
message SearchResponse {
  repeated SearchResult entries = 1;
  map<string, int32> counts_by_kind = 2;  // For UI tabs
  int32 total_count = 3;
  int32 total_pages = 4;
}

// SearchResult - Display projection (not full resource)
message SearchResult {
  ApiResourceKind kind = 1;
  string id = 2;
  string name = 3;
  string slug = 4;
  string qualified_slug = 5;  // "org/slug"
  string org = 6;
  string description = 7;     // From Searchable interface
  ApiResourceVisibility visibility = 8;
  repeated string tags = 9;
  Timestamp created_at = 10;
  Timestamp updated_at = 11;
  float score = 12;           // 0.0-1.0 relevance
}
```

---

## Import Dependencies (Verified to Exist)


| Import                                                                   | Purpose                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto` | `ApiResourceKind` enum (agent, skill, mcp_server, workflow)     |
| `ai/stigmer/commons/apiresource/enum.proto`                              | `ApiResourceVisibility` (visibility_private, visibility_public) |
| `ai/stigmer/commons/rpc/pagination.proto`                                | `PageInfo` (num, size fields)                                   |
| `ai/stigmer/iam/iampolicy/v1/rpcauthorization/method_options.proto`      | `is_skip_authorization` option                                  |
| `buf/validate/validate.proto`                                            | Field validation                                                |
| `google/protobuf/timestamp.proto`                                        | `Timestamp` type                                                |


---

## Validation Rules

**SearchRequest:**

- `query`: Max 500 characters (prevent abuse)
- `org`: If provided, must match slug pattern `^[a-z][a-z0-9-]*$`
- `page.size`: Max 100 (prevent excessive queries)

**SearchResult:**

- All string fields: Required where applicable
- `score`: Range 0.0-1.0

---

## Quality Standards Applied

### Documentation

- Service-level: Purpose, authorization model, usage patterns
- RPC-level: Behavior table, input/output semantics
- Field-level: Purpose, format, examples, defaults

### Validation

- `buf.validate` for all constraints
- Pattern validation for slugs
- Length limits for strings
- Defined-only for enums

### Consistency

- Import ordering: external (google, buf) before internal
- Field numbering: sequential, sensible grouping
- Naming: matches existing codebase conventions

---

## Stub Generation

After creating the proto files, run:

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer/apis
make build
```

This generates stubs in:

- `stubs/go/ai/stigmer/search/v1/` - Go
- `stubs/java/src/main/java/protos/ai/stigmer/search/v1/` - Java
- `stubs/python/stigmer/ai/stigmer/search/v1/` - Python
- `stubs/ts/ai/stigmer/search/v1/` - TypeScript

---

## Verification Checklist

After implementation:

1. `make build` completes without errors
2. Generated Go stubs compile: `go build ./...` in stubs/go
3. Proto lint passes: `buf lint` shows no new warnings
4. Service documentation renders correctly in generated code
5. All imports resolve (no missing dependencies)

