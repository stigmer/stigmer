# MCP Server: README Update + Resource Templates (T05)

**Date**: February 18, 2026

## Summary

Two complementary improvements to `mcp-server-stigmer` delivered in one session. The README was brought fully current with T04's observability and hardening additions. Three URI-addressable MCP Resource Templates were added alongside the existing tools, giving AI clients a second, complementary read path for Stigmer resources — one that requires no tool invocation when the URI is already known. A shared `Fetch()` abstraction was extracted from each domain's tool handler so that both MCP primitives (tools and resources) share a single implementation of the gRPC call logic.

## Problem Statement

### README stale after T04

T04 introduced structured logging (`log/slog`), two new environment variables, graceful HTTP shutdown with a 5-second drain window, and build version injection via `git describe`. None of these were documented. An operator configuring the server for production would have no knowledge of `STIGMER_MCP_LOG_FORMAT`, `STIGMER_MCP_LOG_LEVEL`, or the shutdown behaviour.

### Tools are the only read path

MCP defines two complementary primitives for surfacing data to AI clients:

- **Tools** — called explicitly by the model to query information. Good for discovery, filtering, pagination.
- **Resources** — URI-addressable data that clients can read directly. Good when the client already knows the identifier and wants to fetch state without a tool call round-trip.

The MCP server only exposed tools. Any client that had already learned a resource URI (e.g. from a previous `search` call) had to call a tool again to re-read it.

### Duplicated gRPC call logic

Each domain tool handler contained an identical ~15-line block: extract API key, open gRPC connection, run RPC with 30s timeout, serialize with protojson. Adding resource handlers would have duplicated this across six more files (three handlers × two primitives per domain).

## Solution

### T05-A: README

Added a complete **Resources** section (URI template table), a **Logging** section (stderr-only, text vs json, request log fields, gRPC error classification), a **Graceful Shutdown** section (per-transport drain behaviour), and a build version injection note. Updated the Configuration table with the two new environment variables. Updated the Architecture file map with `rpcerr.go` and `uriutil.go`.

### T05-B: URI Utility

Created `internal/domains/uriutil.go` with a single exported function:

```go
func ParseResourceURI(uri string) (org, slug string, err error)
```

Uses `net/url.Parse` to split `stigmer://{kind}/{org}/{slug}` into segments. Returns clear, user-facing errors for wrong scheme, missing segments, or too many segments. Covered by 10 table-driven unit tests including trailing slash tolerance.

### T05-B: Fetch Extraction

Extracted the shared gRPC call logic into a `Fetch()` function in a new `fetch.go` per domain:

| Function signature | Domain |
|--------------------|--------|
| `Fetch(ctx, serverAddress, org, slug string) (string, error)` | agents, workflows |
| `Fetch(ctx, serverAddress, org, slug, version string) (string, error)` | skills |

Each `Fetch()` handles auth key extraction, connection lifecycle, timeout, RPC call, protojson serialisation, and gRPC error classification. The tool handlers in `tools.go` were slimmed to ~5 lines each — they now just call `Fetch()` and wrap the result in `*mcp.CallToolResult`.

### T05-B: Resource Templates

Added `resources.go` per domain exposing:

- `Template() *mcp.ResourceTemplate` — declares the URI template, name, title, description, MIME type
- `ResourceHandler(serverAddress string) mcp.ResourceHandler` — parses the URI, calls `Fetch()`, wraps result in `*mcp.ReadResourceResult`

The three templates registered at startup:

| URI Template | Resource |
|---|---|
| `stigmer://agents/{org}/{slug}` | Agent definition (JSON) |
| `stigmer://skills/{org}/{slug}` | Skill definition (JSON, latest version) |
| `stigmer://workflows/{org}/{slug}` | Workflow definition (JSON) |

A new `registerResources()` function in `internal/server/server.go` mirrors `registerTools()` and is called from `New()`. Both are logged at INFO on startup.

## Implementation Details

### File inventory

**New files (11)**:

| File | Lines | Purpose |
|------|-------|---------|
| `internal/domains/uriutil.go` | 44 | URI parsing |
| `internal/domains/uriutil_test.go` | 82 | 10 unit tests |
| `internal/domains/agents/fetch.go` | 44 | Shared gRPC fetch |
| `internal/domains/agents/resources.go` | 43 | Resource template + handler |
| `internal/domains/agents/resources_test.go` | 108 | 4 integration tests |
| `internal/domains/skills/fetch.go` | 46 | Shared gRPC fetch |
| `internal/domains/skills/resources.go` | 44 | Resource template + handler |
| `internal/domains/skills/resources_test.go` | 111 | 4 integration tests |
| `internal/domains/workflows/fetch.go` | 44 | Shared gRPC fetch |
| `internal/domains/workflows/resources.go` | 43 | Resource template + handler |
| `internal/domains/workflows/resources_test.go` | 108 | 4 integration tests |

**Modified files (4)**:

| File | Change |
|------|--------|
| `internal/domains/agents/tools.go` | Tool handler delegates to `Fetch()` — shrunk from 69 to 37 lines |
| `internal/domains/skills/tools.go` | Same — shrunk from 76 to 43 lines |
| `internal/domains/workflows/tools.go` | Same — shrunk from 69 to 37 lines |
| `internal/server/server.go` | Added `registerResources()`, wired into `New()` |
| `mcp-server/README.md` | Full documentation update |

### Design decisions

**Templates-only (no static list resources)**: The `search` tool already handles discovery with filtering and pagination. A static `stigmer://agents` resource would have no way to accept org filters and returning all agents across all orgs as a single response is impractical at scale. Resource templates complement tools — they don't replace them.

**Skills return latest version only via URI**: The URI template `stigmer://skills/{org}/{slug}` maps to the latest version. Versioned URIs (`stigmer://skills/{org}/{slug}/{version}`) are a natural future extension once there is a defined use case for pinned-version resource reads.

**`Fetch()` returns `(string, error)` not the proto message**: The string is already serialised JSON. Both the tool handler (wrapping into `TextContent`) and the resource handler (wrapping into `ResourceContents.Text`) need text, not the proto object. Returning the proto would add two more round-trips through protojson in each caller with no benefit.

**`ResourceNotFoundError` vs plain error**: The SDK's `mcp.ResourceNotFoundError(uri)` is reserved for cases where the resource literally does not match any registered template. Once the handler is invoked (template did match), a gRPC NotFound should surface as a plain error with the classified user-facing message from `domains.RPCError()` — consistent with how tool handlers behave.

## Benefits

- **No more README drift**: All seven configuration variables documented, logging and shutdown behaviour documented, architecture map accurate.
- **Zero duplication**: 45 lines of gRPC call logic exist once per domain instead of twice (tool + resource). Future primitives (prompts, etc.) will call `Fetch()` too.
- **Two read paths, one implementation**: AI clients that cache resource URIs from a previous `search` can re-read them as MCP Resources without calling a tool. Both paths hit the same backend logic.
- **Test count: 58 → 70**: 12 new tests (4 per domain package) covering success, malformed URI, missing API key, and gRPC NotFound. All 70 pass under `-race`.

## Impact

- **MCP clients**: Cursor, Claude Desktop, and any SDK-based client that implements `resources/read` can now address agents, skills, and workflows by URI.
- **Tool handlers**: Behaviour unchanged — the `Fetch()` extraction is a pure refactor validated by the existing test suite.
- **Operators**: README is now a reliable reference for configuring log format, log level, and graceful shutdown.
- **Future maintainers**: Adding a new domain (e.g. `mcp_server`) requires implementing one `Fetch()` function and two thin wrappers (`tools.go`, `resources.go`). The structural pattern is established and consistent.

## Related Work

- [T04 — Observability & Hardening](2026-02-18-145040-mcp-server-observability-hardening.md) — introduced logging and shutdown whose docs this session added
- [T03 — Test Suite](2026-02-18-130941-mcp-server-test-suite.md) — established the integration test pattern this session extended
- T06 (future) — Write operations (`apply_agent`, `delete_workflow`, etc.) will call `Fetch()` for pre-flight reads

---

**Status**: ✅ Production Ready
**Timeline**: Session 4 of project 20260217.01.stigmer-mcp-server
