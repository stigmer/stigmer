---
name: T05 README and Resources
overview: Update the MCP server README to reflect T04 changes (logging, shutdown, build) and implement MCP Resource Templates for agents, skills, and workflows, giving MCP clients a URI-addressable read path complementary to the existing tools.
todos:
  - id: t05a-readme
    content: "T05-A: Update README — add log env vars, logging section, graceful shutdown section, build version info, architecture file list"
    status: completed
  - id: t05b-uriutil
    content: "T05-B.1: Create internal/domains/uriutil.go with ParseResourceURI + unit tests"
    status: completed
  - id: t05b-fetch-extract
    content: "T05-B.2: Extract shared Fetch() into fetch.go for agents, skills, workflows; refactor tool handlers to call Fetch(); verify existing tool tests still pass"
    status: completed
  - id: t05b-resource-handlers
    content: "T05-B.3: Add ResourceTemplate() + ResourceHandler() in each domain package with integration tests"
    status: completed
  - id: t05b-register
    content: "T05-B.4: Wire registerResources() into server.go New() function"
    status: completed
  - id: t05b-readme-resources
    content: "T05-B.5: Add Resources section to README documenting the 3 templates"
    status: completed
  - id: t05-final-verify
    content: "T05-Final: Run full test suite (go test -race ./...), go vet, verify build"
    status: completed
isProject: false
---

# T05: README Update + MCP Resource Templates

## T05-A: README Update

The [current README](mcp-server/README.md) is stale after T04's observability and hardening changes. Specific gaps:

### Changes to the Configuration table (lines 54-61)

Add two new rows:

- `STIGMER_MCP_LOG_FORMAT` | `text` | Log output encoding: `text` or `json`
- `STIGMER_MCP_LOG_LEVEL` | `info` | Minimum log severity: `debug`, `info`, `warn`, or `error`

### New section: Logging

Document:

- Structured logging via `log/slog`, always to stderr (stdout reserved for STDIO transport)
- `text` format for local development, `json` for log aggregation / production
- HTTP mode logs each request with: `request_id`, `method`, `path`, `status`, `duration_ms`
- gRPC errors classified into user-friendly messages; raw gRPC errors logged at WARN

### New section: Graceful Shutdown

Document:

- Signal handling: SIGINT and SIGTERM
- HTTP mode: 5-second grace period for in-flight requests, then forced shutdown
- STDIO mode: server stops when client disconnects or signal received
- Both mode: concurrent shutdown of both transports

### Update: Build section

Add version injection detail:

- `make build` injects `buildVersion` via `-ldflags="-X ...buildVersion=$(VERSION)"` from `git describe`
- Binary reports `"dev"` when built without ldflags

### Update: Architecture section (line 91-103)

Add the two new files from T04:

- `internal/domains/rpcerr.go` — gRPC error classification
- `internal/config/config_test.go` — listed under test files or omitted (it's a test file)

---

## T05-B: MCP Resource Templates

### Design

- **Templates only** (no static list resources) — the `search` tool handles discovery
- Three resource templates, one per domain:
  - `stigmer://agents/{org}/{slug}` — read agent definition (JSON)
  - `stigmer://skills/{org}/{slug}` — read latest skill definition (JSON)
  - `stigmer://workflows/{org}/{slug}` — read workflow definition (JSON)
- MIME type: `application/json` for all templates
- Skills return the latest version only (versioned skill URIs can be added in a future task)

### Refactoring: Extract shared Fetch functions

Each domain package (agents, skills, workflows) currently has the gRPC call logic inlined in the tool handler (~15 lines: auth, connection, RPC, serialize). Both the tool handler and the new resource handler need this same logic. Rather than duplicate it, extract a shared function:

```go
// In internal/domains/agents/fetch.go
func Fetch(ctx context.Context, serverAddress, org, slug string) (string, error)
```

- Tool handler calls `Fetch()`, wraps result in `*mcp.CallToolResult`
- Resource handler calls `Fetch()`, wraps result in `*mcp.ReadResourceResult`
- Same pattern for skills (`Fetch(ctx, serverAddress, org, slug, version)`) and workflows

This keeps each handler as a thin adapter for its MCP primitive while the core logic lives in one place.

### URI parsing

Resource handlers receive a URI string (e.g., `stigmer://agents/myorg/code-reviewer`) and must extract `org` and `slug`. Using `net/url.Parse`:

- `url.Host` = resource type (`agents`, `skills`, `workflows`)
- `url.Path` = `/{org}/{slug}` — split to extract parameters

Create a small utility in `internal/domains/uriutil.go`:

```go
func ParseResourceURI(uri string) (org, slug string, err error)
```

Validates segment count, returns clear errors for malformed URIs.

### New files


| File                                           | Purpose                                                  |
| ---------------------------------------------- | -------------------------------------------------------- |
| `internal/domains/uriutil.go`                  | URI parsing for resource handlers                        |
| `internal/domains/uriutil_test.go`             | Unit tests: valid URIs, missing segments, malformed URIs |
| `internal/domains/agents/fetch.go`             | Shared `Fetch()` extracted from tool handler             |
| `internal/domains/agents/resources.go`         | `ResourceTemplate()` + `ResourceHandler()`               |
| `internal/domains/agents/resources_test.go`    | Integration test (same pattern as `tools_test.go`)       |
| `internal/domains/skills/fetch.go`             | Shared `Fetch()`                                         |
| `internal/domains/skills/resources.go`         | Template + handler                                       |
| `internal/domains/skills/resources_test.go`    | Integration test                                         |
| `internal/domains/workflows/fetch.go`          | Shared `Fetch()`                                         |
| `internal/domains/workflows/resources.go`      | Template + handler                                       |
| `internal/domains/workflows/resources_test.go` | Integration test                                         |


### Modified files


| File                                  | Change                                                      |
| ------------------------------------- | ----------------------------------------------------------- |
| `internal/domains/agents/tools.go`    | Tool handler calls `Fetch()` instead of inlining gRPC logic |
| `internal/domains/skills/tools.go`    | Same refactor                                               |
| `internal/domains/workflows/tools.go` | Same refactor                                               |
| `internal/server/server.go`           | Add `registerResources()` alongside `registerTools()`       |
| `mcp-server/README.md`                | Add Resources section documenting the 3 templates           |


### Registration in server.go

```go
func registerResources(srv *mcp.Server, serverAddress string) {
    srv.AddResourceTemplate(agents.ResourceTemplate(), agents.ResourceHandler(serverAddress))
    srv.AddResourceTemplate(skills.ResourceTemplate(), skills.ResourceHandler(serverAddress))
    srv.AddResourceTemplate(workflows.ResourceTemplate(), workflows.ResourceHandler(serverAddress))
    slog.Info("resource templates registered", "count", 3)
}
```

### Test strategy

- **URI parsing**: table-driven unit tests covering valid URIs, missing segments, empty scheme, trailing slashes
- **Resource handlers**: integration tests using the same `testutil/grpctest.go` pattern as tool tests — real gRPC server with `Unimplemented`* mocks, verify handler returns correct `ReadResourceResult`
- **Existing tool tests**: must still pass after the `Fetch()` extraction refactor (no behavior change)
- All tests under `-race` and `go vet`

