# MCP Server: `mcpservers` Domain — Tool and Resource Template

**Date**: February 19, 2026

## Summary

Adds the `mcpservers` domain package to the MCP server, completing read coverage
for all four searchable Stigmer resource kinds. The package introduces the
`get_mcp_server` tool and the `stigmer://mcp-servers/{org}/{slug}` resource
template, both backed by `McpServerQueryController.GetByReference`. All 12
`mcp-server` packages pass under `-race` with `go vet` clean.

## Problem Statement

Three of the four searchable kinds (`agent`, `skill`, `workflow`) had domain
packages with tools, resource templates, and `resource_uri` enrichment in
search results. `mcp_server` was the only searchable kind without any of these.
This created an asymmetry:

### Pain Points

- `search` results for `mcp_server` entries had no `resource_uri` field — MCP
  clients could discover an MCP server via search but had no direct-read path
- No `get_mcp_server` tool — the only way to retrieve a full MCP server
  definition was to parse search results manually
- `kindToAuthority` in `uriutil.go` explicitly commented `mcp_server` as having
  no template, a known gap in the codebase
- Tests asserted that `mcp_server` search entries must *not* have `resource_uri`
  — a negative assertion documenting the gap rather than the intent

## Solution

Create a new `mcpservers` domain package following the established domain
pattern (`fetch` → `tools` → `resources`) and wire it into the server
registration, URI utilities, search enrichment, and tests.

## Implementation Details

### New package: `mcp-server/internal/domains/mcpservers/`

**`fetch.go`** — Single `Fetch(ctx, serverAddress, org, slug) (string, error)`
function used by both the tool handler and resource handler. Creates a gRPC
connection, calls `McpServerQueryControllerClient.GetByReference` with
`ApiResourceKind_mcp_server`, and returns the response serialized via
`domains.MarshalJSON` (protojson with `UseProtoNames: true`).

**`tools.go`** — `GetMcpServerInput` struct (org + slug), `Tool()` returning
the `get_mcp_server` tool definition, and `Handler()` returning the typed
closure that delegates to `Fetch`.

**`resources.go`** — `Template()` returning the `stigmer://mcp-servers/{org}/{slug}`
resource template with name `stigmer_mcp_server`, and `ResourceHandler()`
parsing the URI via `domains.ParseResourceURI` and delegating to `Fetch`.

**`tools_test.go`** — Embedded `mockMcpServerQueryController` (implements
`UnimplementedMcpServerQueryControllerServer` + overrides `GetByReference`),
plus five tests: metadata, success (validates org/slug/kind on gRPC request and
JSON response), missing API key, gRPC not-found. The mock is defined in
`tools_test.go` and shared with `resources_test.go` (same package).

**`resources_test.go`** — Five tests: template metadata (URI template, MIME
type, non-empty name), resource handler success (validates gRPC request fields,
returned URI, MIME type, JSON body), malformed URI, missing API key, gRPC
not-found.

### URI authority: `mcp-servers`

`mcp_server` (proto enum) maps to `mcp-servers` (URI authority). This is the
first hyphenated authority in the scheme — existing ones are `agents`, `skills`,
`workflows`. Hyphens are conventional in URI path components and produce
readable URIs: `stigmer://mcp-servers/acme/my-server`. The mapping lives in the
`kindToAuthority` map in `uriutil.go` — the single source of truth.

### No versioned template

`mcp_server` has `is_versioned: false` in `kind_meta`. Registering a versioned
URI template would create a false API surface (version segments would be silently
ignored). Consistent with the agents/workflows pattern.

### Modified files

| File | Change |
|------|--------|
| `uriutil.go` | Added `"mcp_server": "mcp-servers"` to `kindToAuthority`; updated doc comment |
| `uriutil_test.go` | Updated `mcp_server` table case (was `want: ""`); added round-trip test |
| `server.go` | Imported `mcpservers`; registered in `registerTools` and `registerResources`; log counts updated from 4 to 5 |
| `search/tools_test.go` | `TestEnrichSearchResponse_mixedKinds` now asserts `resource_uri: "stigmer://mcp-servers/acme/my-server"` (was: field must be absent) |
| `README.md` | Intro sentence, tools table, resources table, architecture section |

## Benefits

- **Complete read surface**: All four searchable kinds are now fully reachable
  via both the `get_*` tool interface and the `resources/read` resource
  interface. MCP clients that follow `resource_uri` links from search results
  will now get a valid URI for every result entry regardless of kind.
- **No special-casing in search**: The `enrichSearchResponse` function was
  already correct — it uses `BuildResourceURI` which returns empty string for
  unknown kinds and populates the field for known ones. Adding `mcp_server` to
  `kindToAuthority` was the only change needed; no search logic changed.
- **Test symmetry restored**: The mixed-kinds test now has four positive
  assertions instead of three positives and one "must be absent". The codebase
  no longer documents a known gap via a negative test assertion.
- **Pattern consistency**: The `mcpservers` package is structurally identical to
  `agents` and `workflows` — new contributors can onboard by reading any of the
  three.

## Impact

- MCP clients performing `search(kinds: ["mcp_server"])` now receive
  `resource_uri` in every result entry, enabling direct `resources/read` calls
  without manual URI construction.
- `get_mcp_server` is available as a first-class tool in the MCP server's tool
  registry, discoverable via `tools/list`.
- No changes to gRPC API, proto definitions, or public MCP server package
  (`pkg/mcpserver/`). The public API surface is unchanged.

## Related Work

- T09 (session 8): Added `BuildResourceURI` and `enrichSearchResponse` — the
  infrastructure that T10 builds on.
- T08 (session 7): Workflows domain, establishing the non-versioned domain
  pattern that `mcpservers` follows.
- T10 closes the last gap in read coverage for the four searchable kinds. T11
  will address write operations (`apply_*` / `delete_*` tools).

---

**Status**: ✅ Production Ready
**Timeline**: Session 9, February 19, 2026
