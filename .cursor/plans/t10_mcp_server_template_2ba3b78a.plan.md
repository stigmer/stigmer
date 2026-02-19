---
name: T10 MCP Server Template
overview: Create a new `mcpservers` domain package with resource template, tool, and fetch logic — completing resource template coverage for all four searchable kinds — and wire it into the server registration, URI utilities, search enrichment, and tests.
todos:
  - id: create-fetch
    content: Create `mcp-server/internal/domains/mcpservers/fetch.go` — gRPC fetch via McpServerQueryController.GetByReference
    status: completed
  - id: create-tools
    content: Create `mcp-server/internal/domains/mcpservers/tools.go` — get_mcp_server tool definition and handler
    status: completed
  - id: create-resources
    content: Create `mcp-server/internal/domains/mcpservers/resources.go` — resource template and handler for stigmer://mcp-servers/{org}/{slug}
    status: completed
  - id: create-tools-test
    content: Create `mcp-server/internal/domains/mcpservers/tools_test.go` — mock, metadata, success, error tests
    status: completed
  - id: create-resources-test
    content: Create `mcp-server/internal/domains/mcpservers/resources_test.go` — template metadata, success, malformed URI, missing key, gRPC error tests
    status: completed
  - id: update-uriutil
    content: Add `mcp_server` → `mcp-servers` to `kindToAuthority` in uriutil.go, update doc comment
    status: completed
  - id: update-uriutil-test
    content: "Update uriutil_test.go: change mcp_server test case expectation from empty to full URI, add round-trip test"
    status: completed
  - id: update-server
    content: "Wire mcpservers into server.go: import, registerTools, registerResources, update log counts"
    status: completed
  - id: update-search-test
    content: "Update search tools_test.go: mcp_server entries now get resource_uri in enrichment test"
    status: completed
  - id: update-readme
    content: "Update README.md: tools table, resources table, architecture section"
    status: completed
  - id: verify
    content: Run go test -race and go vet across all mcp-server packages
    status: completed
isProject: false
---

# T10: MCP Server Resource Template and Tool

## Context

Three of the four searchable kinds have domain packages with tools, resource templates, and `resource_uri` enrichment in search results. `mcp_server` is the missing one. This task closes that gap.

**Proto facts** (from `api_resource_kind.proto`):

- `mcp_server` — `is_versioned: false`, `not_search_indexed: false`, group `agentic`, version `v1`
- `McpServerQueryController` has `GetByReference(ApiResourceReference) returns (McpServer)` — same pattern as agents/workflows

**Established pattern per domain** (agents, skills, workflows):

- `fetch.go` — gRPC fetch shared by tool and resource handler
- `tools.go` — MCP tool definition + handler
- `tools_test.go` — mock gRPC service, metadata test, success/error integration tests
- `resources.go` — resource template + handler
- `resources_test.go` — metadata, success, malformed URI, missing API key, gRPC error tests

## Design Decisions

### URI authority: `mcp-servers`

The next-task spec calls for `stigmer://mcp-servers/{org}/{slug}`. This introduces the first hyphenated authority (existing ones are `agents`, `skills`, `workflows` — all single-word). Hyphens are conventional in URIs and this reads well. The `kindToAuthority` map in [uriutil.go](mcp-server/internal/domains/uriutil.go) handles the mapping cleanly.

### Package name: `mcpservers`

Go convention — no hyphens or underscores in package names. Matches the `agents`/`skills`/`workflows` naming.

### No versioned template

`mcp_server` has `is_versioned: false`. Only the 2-segment URI (`{org}/{slug}`) template is needed. This matches the agents and workflows pattern (skills is the only kind with a versioned template).

### Tool included

The original Option B description only mentions the resource template, but every existing domain that has a template also has a tool. Adding `get_mcp_server` maintains pattern consistency and is trivial once `Fetch` exists. The tool makes MCP servers accessible through both the tool and resource interfaces, just like the other three kinds.

## Files to Create

### New package: `mcp-server/internal/domains/mcpservers/`

- `**fetch.go`** — `Fetch(ctx, serverAddress, org, slug) (string, error)` using `McpServerQueryControllerClient.GetByReference` with `ApiResourceKind_mcp_server`. Pattern: [agents/fetch.go](mcp-server/internal/domains/agents/fetch.go).
- `**tools.go`** — `GetMcpServerInput` struct, `Tool()` returning `get_mcp_server`, `Handler()` closure. Pattern: [agents/tools.go](mcp-server/internal/domains/agents/tools.go).
- `**tools_test.go**` — Mock `McpServerQueryController`, metadata test, success/error integration tests. Pattern: [agents/tools_test.go](mcp-server/internal/domains/agents/tools_test.go).
- `**resources.go**` — `Template()` returning `stigmer://mcp-servers/{org}/{slug}` with name `stigmer_mcp_server`, `ResourceHandler()`. Pattern: [agents/resources.go](mcp-server/internal/domains/agents/resources.go).
- `**resources_test.go**` — Template metadata, success, malformed URI, missing API key, gRPC not found. Pattern: [agents/resources_test.go](mcp-server/internal/domains/agents/resources_test.go).

## Files to Modify

- **[mcp-server/internal/domains/uriutil.go](mcp-server/internal/domains/uriutil.go)** — Add `"mcp_server": "mcp-servers"` to `kindToAuthority` map. Update `BuildResourceURI` doc comment to remove the "e.g. mcp_server" no-template example.
- **[mcp-server/internal/domains/uriutil_test.go](mcp-server/internal/domains/uriutil_test.go)** — Update the `TestBuildResourceURI` case `"mcp_server has no resource template"` to expect `"stigmer://mcp-servers/acme/my-server"` instead of `""`. Add a round-trip test for `mcp_server`.
- **[mcp-server/internal/server/server.go](mcp-server/internal/server/server.go)** — Import `mcpservers`, register tool in `registerTools`, register template in `registerResources`, update log counts.
- **[mcp-server/internal/domains/search/tools_test.go](mcp-server/internal/domains/search/tools_test.go)** — Update `TestEnrichSearchResponse_mixedKinds`: the `mcp_server` entry should now have `resource_uri: "stigmer://mcp-servers/acme/my-server"` instead of being absent.
- **[mcp-server/README.md](mcp-server/README.md)** — Add `get_mcp_server` to Tools table. Add `stigmer://mcp-servers/{org}/{slug}` to Resources table. Update Architecture section with `internal/domains/mcpservers/` line. Update tool/template counts in log messages if mentioned.

## Verification

- `go test -race -count=1 ./mcp-server/...` — all packages green
- `go vet ./mcp-server/...` — clean

