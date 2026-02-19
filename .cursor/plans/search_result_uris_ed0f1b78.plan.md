---
name: Search Result URIs
overview: "Add `resource_uri` fields to search tool results, bridging the discovery-to-read workflow so MCP clients can pipe search results directly into resource reads. Option B (versioned templates for agents/workflows) is skipped because both are `is_versioned: false` in the backend."
todos:
  - id: build-uri
    content: Add BuildResourceURI to uriutil.go + table-driven tests in uriutil_test.go
    status: completed
  - id: enrich-search
    content: Add enrichSearchResponse to search/tools.go, update Handler to use it
    status: completed
  - id: enrich-tests
    content: Add enrichment tests + update existing handler tests in search/tools_test.go
    status: completed
  - id: readme
    content: Update README.md to document resource_uri in search results
    status: completed
  - id: verify
    content: Run go test -race and go vet across all mcp-server packages
    status: completed
isProject: false
---

# T09: Search Result URIs

## Context

The `search` tool currently returns entries with `kind`, `org`, and `slug` fields, but no URI. An MCP client that wants to read a discovered resource must manually construct the `stigmer://` URI. This task closes that gap: each search result entry will include a `resource_uri` that can be passed directly to `resources/read`.

**Option B (versioned templates for agents/workflows) was skipped** because the proto `kind_meta` declares `agent` and `workflow` as `is_versioned: false`, and the `ApiResourceReference.version` docs say the field is ignored for non-versioned resources. Adding versioned URI templates would silently return the latest version regardless of requested version -- a false API surface.

## Design Decisions

### URI construction belongs in the MCP layer, not the proto

The `stigmer://` URI scheme is an MCP-specific concept. Adding a `resource_uri` field to the `SearchResult` proto would couple the core backend to MCP concerns. Instead, the MCP search handler enriches the response before returning it to the client. This is a **presentation-layer enrichment**.

### Kind-to-authority mapping

Each `SearchResult.kind` maps to a plural URI authority:

- `agent` -> `stigmer://agents/{org}/{slug}`
- `skill` -> `stigmer://skills/{org}/{slug}`
- `workflow` -> `stigmer://workflows/{org}/{slug}`
- `mcp_server` -> **no URI** (no resource template registered; omitted from output)

Unknown/future kinds also produce no URI -- forward-compatible by default.

### Implementation: JSON round-trip enrichment

The handler currently does `domains.MarshalJSON(resp)` (protojson). The new flow:

1. Marshal proto to JSON via protojson (preserves proto field names, RFC 3339 timestamps, enum string names)
2. Unmarshal to `map[string]any`
3. For each entry, compute `resource_uri` from the proto object (type-safe access to `Kind`, `Org`, `Slug`) and inject into the map
4. Re-marshal with `json.MarshalIndent` (2-space indent, matching existing formatting)

**Trade-off acknowledged:** The final marshal uses `encoding/json` instead of `protojson`, which means map keys are alphabetically sorted rather than proto-field-ordered. This is cosmetically different but semantically identical. All values were already converted to JSON-native forms by protojson in step 1.

**Short-circuit:** When `len(resp.Entries) == 0`, skip enrichment and use `domains.MarshalJSON(resp)` directly (no round-trip overhead).

## Files to Change

### 1. `[mcp-server/internal/domains/uriutil.go](mcp-server/internal/domains/uriutil.go)` -- Add `BuildResourceURI`

Add a `BuildResourceURI(kind, org, slug string) string` function. This is the inverse of `ParseResourceURI`: it constructs a URI from parts.

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

Returns empty string for unsupported kinds (`mcp_server`, unknown) or invalid inputs.

### 2. `[mcp-server/internal/domains/uriutil_test.go](mcp-server/internal/domains/uriutil_test.go)` -- Add `BuildResourceURI` tests

Table-driven tests covering:

- `agent` -> `stigmer://agents/acme/code-reviewer`
- `skill` -> `stigmer://skills/acme/deploy-k8s`
- `workflow` -> `stigmer://workflows/acme/ci-pipeline`
- `mcp_server` -> empty (no resource template)
- Unknown kind -> empty
- Empty org -> empty
- Empty slug -> empty
- Empty kind -> empty

### 3. `[mcp-server/internal/domains/search/tools.go](mcp-server/internal/domains/search/tools.go)` -- Add enrichment, update handler

- Add `enrichSearchResponse(resp *searchv1.SearchResponse) (string, error)` -- performs the JSON round-trip enrichment described above
- Update `Handler` to call `enrichSearchResponse(resp)` instead of `domains.MarshalJSON(resp)`
- Add `encoding/json` import

### 4. `[mcp-server/internal/domains/search/tools_test.go](mcp-server/internal/domains/search/tools_test.go)` -- Add enrichment tests

- **Unit test for `enrichSearchResponse`**: mock `SearchResponse` with entries of kind agent, skill, workflow, mcp_server. Verify agent/skill/workflow entries have correct `resource_uri`, mcp_server entries have no `resource_uri`.
- **Unit test for empty response**: verify no crash, output matches `domains.MarshalJSON`.
- **Update `TestHandler_success`**: verify the response JSON contains `resource_uri` for the returned entries.

### 5. `[mcp-server/README.md](mcp-server/README.md)` -- Document the `resource_uri` field

Update the Tools table description for `search` to mention that results include `resource_uri` fields for direct resource reads. Add a brief note about the search-to-read workflow.

## Verification

- `go test -race ./mcp-server/...` -- all packages pass
- `go vet ./mcp-server/...` -- clean

