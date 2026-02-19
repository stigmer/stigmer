# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, MCP servers, and workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, MCP servers, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 19, 2026 — T10 (MCP Server Resource Template and Tool) — COMPLETE
**Current Task**: T11 — Ready to pick (see candidates below)
**Status**: T01 ✅ | T02 ✅ | T03 ✅ | T04 ✅ | T05 ✅ | T06 ✅ | T07 ✅ | T08 ✅ | T09 ✅ | T10 ✅ | T11 Pending

## Session Progress (2026-02-19, Session 9)

**T10 — MCP Server Resource Template and Tool (Complete)**

All 12 MCP server packages passing under `-race`. `go vet` clean.

**Changes delivered:**

| Item | Description |
|---|---|
| T10-A | New `mcp-server/internal/domains/mcpservers/` package — `fetch.go`, `tools.go`, `resources.go` |
| T10-B | `get_mcp_server` MCP tool (backed by `McpServerQueryController.GetByReference`) |
| T10-C | `stigmer://mcp-servers/{org}/{slug}` resource template — all four searchable kinds now have templates |
| T10-D | `kindToAuthority` in `uriutil.go` extended with `"mcp_server": "mcp-servers"` |
| T10-E | `uriutil_test.go` — updated `mcp_server` case, added round-trip test |
| T10-F | `search/tools_test.go` — `mcp_server` entries now assert `resource_uri` in `enrichSearchResponse` test |
| T10-G | `server.go` — tool and template registered; log counts updated to 5/5 |
| T10-H | `README.md` — intro, tools table, resources table, architecture section updated |
| T10-I | 10 new tests in `mcpservers/tools_test.go` and `mcpservers/resources_test.go` |

**Key design decisions:**

- `mcp-servers` authority (hyphenated): first hyphenated authority in the URI scheme. Conventional in URIs; maps cleanly from proto `mcp_server` to URI `mcp-servers`.
- Tool included alongside template: consistency with agents/skills/workflows — every kind with a template also has a `get_*` tool. No cost once `Fetch` exists.
- No versioned template: `mcp_server` is `is_versioned: false` — mirrors agents/workflows pattern.
- `kindToAuthority` remains the single source of truth for kind→URI-authority mapping.

## Next Steps (T11 Candidates — pick one)

### Option A: Write Operations (bigger scope, ~1-2 days)

Add mutation tools for all four domain kinds:
- `apply_agent`, `apply_skill`, `apply_mcp_server`, `apply_workflow` — create/update
- `delete_agent`, `delete_skill`, `delete_mcp_server`, `delete_workflow`
- Requires `CommandController` gRPC stubs and corresponding test doubles per domain

### Option B: Test Coverage Report (~15 min)

Run `go test -coverprofile=coverage.out ./mcp-server/...` and review per-package coverage. Identify any meaningful gaps before moving to write operations. Recommended first step before Option A.

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
- "Continue with T11 Option A (write operations)" — mutation tools for all four kinds
- "Continue with T11 Option B (test coverage)" — coverage baseline before write operations
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-9.md  — T10
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-8.md  — T09
mcp-server/  — Implementation
mcp-server/internal/domains/uriutil.go  — URI parsing + building (kindToAuthority)
mcp-server/internal/domains/mcpservers/  — MCP server domain (new in T10)
mcp-server/internal/domains/search/tools.go  — search tool with resource_uri enrichment
client-apps/cli/cmd/stigmer/root/mcp_server.go  — CLI embedding with config bridging
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
