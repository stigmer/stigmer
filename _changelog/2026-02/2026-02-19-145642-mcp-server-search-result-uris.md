# MCP Server: Search Result URIs (T09)

**Date**: February 19, 2026

## Summary

The `search` MCP tool now includes a `resource_uri` field in each result entry for kinds that have a registered resource template (`agent`, `skill`, `workflow`). MCP clients can pass this URI directly to `resources/read` — closing the discovery-to-read workflow without any manual URI construction. The implementation also introduced `BuildResourceURI`, the inverse of the existing `ParseResourceURI`, which centralizes the kind-to-URI-authority mapping and serves as the single extension point for future resource kinds.

## Problem Statement

The MCP server provided two paths to access Stigmer resources:

1. **Tools** (`get_agent`, `get_skill`, `get_workflow`) — require explicit `org` + `slug` inputs
2. **Resources** (`stigmer://agents/{org}/{slug}`, etc.) — require the client to already know the URI

The `search` tool bridged discovery, returning `kind`, `org`, `slug`, `name`, and other fields — but not a `resource_uri`. An MCP client that found a resource via `search` and then wanted to read it via `resources/read` had to manually construct `stigmer://{kind-plural}/{org}/{slug}`. This is brittle (the plural mapping is an implementation detail) and requires client-side knowledge that the server should own.

### Pain Points

- Discovery and read were disconnected — the `search` result contained all the data needed to construct a URI but didn't do so
- The kind-to-authority mapping (`agent` → `agents`) was implicit knowledge, not codified anywhere
- MCP clients that wanted to "search then read" needed to implement URI construction logic themselves, duplicating server-side knowledge

## Solution

A presentation-layer enrichment in the search handler: after receiving the `SearchResponse` from gRPC, the handler injects a `resource_uri` field into each entry before serializing to JSON. The enrichment uses the proto objects (type-safe access to `Kind`, `Org`, `Slug`) and the new `BuildResourceURI` utility function, which owns the authoritative kind-to-authority mapping.

Entries whose kind has no registered resource template (`mcp_server` today) are left without a `resource_uri`. This is a deliberate and forward-compatible choice: when an `mcp_server` resource template is added, a single entry in the `kindToAuthority` map wires up the URI — no other code changes required.

## Implementation Details

### `BuildResourceURI` — `mcp-server/internal/domains/uriutil.go`

The inverse of `ParseResourceURI`. Accepts a kind name (as the proto enum string, e.g. `"agent"`), org, and slug; returns a fully-formed `stigmer://` URI or an empty string for unsupported inputs.

```go
var kindToAuthority = map[string]string{
    "agent":    "agents",
    "skill":    "skills",
    "workflow": "workflows",
}

func BuildResourceURI(kind, org, slug string) string {
    authority, ok := kindToAuthority[kind]
    if !ok || org == "" || slug == "" {
        return ""
    }
    return fmt.Sprintf("stigmer://%s/%s/%s", authority, org, slug)
}
```

The map is the single source of truth for which kinds have resource templates. `mcp_server` is intentionally absent — no template is registered for it today.

### `enrichSearchResponse` — `mcp-server/internal/domains/search/tools.go`

A JSON round-trip enrichment function:

1. Marshal proto → JSON via `protojson` (preserves proto field names, enum string names, RFC 3339 timestamps)
2. Unmarshal to `map[string]any`
3. For each entry, call `BuildResourceURI` using the typed proto object (not the JSON string) and inject `resource_uri` into the map if non-empty
4. Re-marshal with `encoding/json` (2-space indent, matching the existing format)

Short-circuits to `domains.MarshalJSON` when there are no entries — no round-trip overhead for empty results.

The approach uses proto objects for URI construction (type-safe, no string parsing) and the JSON map for output mutation (avoids changing the serialization path for the rest of the response fields).

### Test coverage added

| Test | What it verifies |
|------|-----------------|
| `TestBuildResourceURI` (8 cases) | agent, skill, workflow map correctly; mcp_server, unknown kind, empty inputs return `""` |
| `TestBuildResourceURI_roundTrip` | `BuildResourceURI` output is valid input to `ParseResourceURI` |
| `TestEnrichSearchResponse_mixedKinds` | All 4 kinds in one response: agent/skill/workflow get URI, mcp_server entry has no `resource_uri` key |
| `TestEnrichSearchResponse_emptyEntries` | No crash, valid JSON output on empty entry list |
| `TestHandler_success` (updated) | End-to-end handler test now asserts `resource_uri` is present in the returned JSON |

### Option B deferred: versioned templates for agents/workflows

During planning, Option B (adding `stigmer://agents/{org}/{slug}/{version}` and `stigmer://workflows/{org}/{slug}/{version}`) was evaluated and deliberately skipped. The `ApiResourceKind` proto's `kind_meta` option marks `agent` and `workflow` as `is_versioned: false`, and the `ApiResourceReference.version` field documentation states it is ignored for non-versioned resources. Adding versioned URI templates would create a false API surface — clients requesting a specific version would silently receive the latest. This will be revisited when agent/workflow versioning is added to the backend.

## Benefits

- **Zero manual URI construction** for MCP clients: `search` returns a `resource_uri` ready to pass to `resources/read`
- **Single source of truth** for kind → URI authority mapping in `BuildResourceURI`
- **Forward-compatible**: unknown kinds produce no URI; adding a new kind's template requires one map entry
- **No production code changes** to existing tool or resource handlers — purely additive
- All 11 `mcp-server` packages pass under `-race`; `go vet` clean

## Impact

- **MCP clients** (Cursor, Claude Desktop, etc.) can now implement a clean search-then-read workflow using only the `search` tool output, without any client-side URI assembly
- **`uriutil.go`** now provides both Parse and Build operations — a complete, symmetric URI utility
- The `kindToAuthority` map makes the relationship between the proto enum and resource templates explicit and auditable in one place

## Related Work

- T08: Versioned Skill Resources — established `ParseVersionedResourceURI` and two-template pattern for skills
- T07: HTTP transport, auth middleware
- T01–T06: Foundation, tools, resource templates, CLI embedding, integration tests

---

**Status**: ✅ Production Ready
**Timeline**: Single session (February 19, 2026, Session 8)
