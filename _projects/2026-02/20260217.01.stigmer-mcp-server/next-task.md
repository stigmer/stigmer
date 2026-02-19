# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 19, 2026 — T09 (Search Result URIs) — COMPLETE
**Current Task**: T10 — Ready to pick (see candidates below)
**Status**: T01 ✅ | T02 ✅ | T03 ✅ | T04 ✅ | T05 ✅ | T06 ✅ | T07 ✅ | T08 ✅ | T09 ✅ | T10 Pending

## Session Progress (2026-02-19, Session 8)

**T09 — Search Result URIs (Complete)**

All 11 MCP server packages passing under `-race`. `go vet` clean.

**Changes delivered:**

| Item | Description |
|---|---|
| T09-A | `BuildResourceURI(kind, org, slug) string` in `uriutil.go` — inverse of `ParseResourceURI`; maps `agent`/`skill`/`workflow` to plural URI authorities; returns `""` for unsupported kinds |
| T09-B | 8 table-driven tests + 1 round-trip test for `BuildResourceURI` in `uriutil_test.go` |
| T09-C | `enrichSearchResponse(resp) (string, error)` in `search/tools.go` — JSON round-trip enrichment injecting `resource_uri` into qualifying entries; short-circuits on empty entry list |
| T09-D | `Handler` updated to call `enrichSearchResponse`; `encoding/json` import added |
| T09-E | 2 new unit tests (`mixedKinds`, `emptyEntries`) + updated `TestHandler_success` in `search/tools_test.go` |
| T09-F | Updated `README.md` — Tools table, Resources section, Architecture line |

**Key design decisions:**

- Option B (versioned templates for agents/workflows) was skipped: `agent` and `workflow` are `is_versioned: false` in `kind_meta`. Adding versioned URI templates would silently ignore the version — a false API surface. Deferred until versioning is supported in the backend.
- `resource_uri` enrichment lives in the MCP layer, not the proto. `stigmer://` is an MCP concept; coupling it to the core proto would be a layer violation.
- `kindToAuthority` map in `uriutil.go` is the single source of truth for which kinds have resource templates. When `mcp_server` gets a template, one map entry wires it up.
- `mcp_server` entries intentionally omit `resource_uri` — no template is registered for that kind today.

## Next Steps (T10 Candidates — pick one)

### Option A: Write Operations (bigger scope, ~1-2 days)

Add mutation tools:
- `apply_agent`, `apply_skill`, `apply_workflow` — create/update
- `delete_agent`, `delete_skill`, `delete_workflow`
- Requires `CommandController` gRPC stubs and corresponding test doubles

### Option B: MCP Server Resource Template (~1 hour)

Add `stigmer://mcp-servers/{org}/{slug}` resource template to complete the suite — all four searchable kinds would then have resource templates. Wire up `kindToAuthority` in `uriutil.go` (one line) and register the template in `server.go`.

### Option C: Test Coverage Report (~15 min)

Run `go test -coverprofile=coverage.out ./mcp-server/...` and review per-package coverage. Identify any meaningful gaps before moving to write operations.

## Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SDK | `modelcontextprotocol/go-sdk` v1.3.0 | Official, typed handlers, native Streamable HTTP |
| Location | `mcp-server/` at repo root | Neither client-app nor backend service; client-facing infrastructure |
| Public API | `pkg/mcpserver/` | Minimal surface: Config + DefaultConfig + Run; callers never import internal/ |
| Auth (STDIO) | Context-injected at server.Run() base ctx | SDK propagates context to all tool handlers — no global state |
| Auth (HTTP) | Bearer token extracted per-request in middleware | Each user brings their own key |
| Auth (local) | No auth — `APIKey()` returns empty, gRPC skips PerRPCCredentials | Matches kubectl/Pulumi/Terraform pattern |
| Config source | CLI: flags > env > config.yaml > defaults | Standard CLI precedence; config.yaml bridges existing login session |
| List tools | Unified `search` via `SearchService.search` | Domain controllers have no list RPCs; search covers list+discover |
| Serialization | `protojson` with `UseProtoNames: true` | Clean JSON, RFC 3339 timestamps, no manual struct mapping |
| Integration tests | Real gRPC server + embedded Unimplemented* mocks | Zero production code changes; validates full handler path |
| Logging | `log/slog` to stderr | Stdlib, structured, stderr-only (stdout reserved for STDIO transport) |
| Error messages | `domains.RPCError(err, resourceDesc)` | Classifies gRPC codes into user-friendly messages; logs raw error |
| RPC timeout | `DefaultRPCTimeout = 30s` via `context.WithTimeout` | Fails fast on unreachable servers; avoids 2min TCP timeout hangs |
| Resources | Templates only (no static list resources) | `search` tool handles discovery; static list resources can't paginate or filter |
| Versioned resources | Two templates per domain (latest + versioned) | Shorter URI stays canonical; no ambiguity in routing |
| URI parsing | `ParseResourceURI` (2-seg) + `ParseVersionedResourceURI` (2-or-3-seg) | Existing agents/workflows use strict parser; skills uses flexible one |
| URI building | `BuildResourceURI(kind, org, slug)` in `uriutil.go` | Inverse of Parse; single source of truth for kind→authority mapping |
| Search enrichment | `enrichSearchResponse` in search handler | `resource_uri` is MCP-specific; enrichment at presentation layer, not proto |
| Fetch abstraction | `Fetch()` in `fetch.go` per domain | Single implementation shared by tool and resource handlers |
| CLI embed | Foreground command, not daemon | MCP server is stateless; no lifecycle management needed |

## Quick Resume Commands

When starting the next session:
- "Continue with T10 Option A (write operations)" — mutation tools
- "Continue with T10 Option B (mcp_server resource template)" — quick add to complete the suite
- "Continue with T10 Option C (test coverage)" — coverage review before write operations
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-8.md  — T09
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-7.md  — T08
mcp-server/  — Implementation
mcp-server/internal/domains/uriutil.go  — URI parsing + building
mcp-server/internal/domains/search/tools.go  — search tool with resource_uri enrichment
client-apps/cli/cmd/stigmer/root/mcp_server.go  — CLI embedding with config bridging
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
