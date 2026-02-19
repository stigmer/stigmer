# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, MCP servers, and workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, MCP servers, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 19, 2026 — T11-B (Test Coverage Report) — COMPLETE
**Current Task**: T11-A — Ready to pick
**Status**: T01 ✅ | T02 ✅ | T03 ✅ | T04 ✅ | T05 ✅ | T06 ✅ | T07 ✅ | T08 ✅ | T09 ✅ | T10 ✅ | T11-B ✅ | T11-A Pending

## Session Progress (2026-02-19, Session 10)

**T11-B — Test Coverage Report (Complete)**

All 12 MCP server packages passing under `-race`. `go vet` clean.

**Coverage baseline established:**

| Package | Coverage |
|---|---|
| `internal/auth` | 100.0% |
| `internal/config` | 100.0% |
| `internal/domains` | 88.9% |
| `internal/domains/agents` | 96.2% |
| `internal/domains/mcpservers` | 96.2% |
| `internal/domains/search` | 87.7% |
| `internal/domains/skills` | 97.1% |
| `internal/domains/workflows` | 96.2% |
| `internal/grpc` | 90.9% |
| `internal/server` | 25.7% |
| `pkg/mcpserver` | 34.5% |
| **Total** | **72.7%** |

**Changes delivered:**

| Item | Description |
|---|---|
| T11-B-A | New `jsonutil_test.go` — 3 tests for `MarshalJSON` (valid message, proto-name verification, nil) |
| T11-B-B | New `TestHandler_grpcErrorWithOrg` in `search/tools_test.go` — covers org-scoped error message branch |
| T11-B-C | Full gap analysis documented in session checkpoint |

**Coverage health summary:**

- Domain packages (`agents`, `mcpservers`, `skills`, `workflows`): all 96%+ — strong
- Shared utilities (`rpcerr`, `uriutil`, `jsonutil`): 75-100% — remaining gaps are defensive/unreachable error paths
- Infrastructure (`server`, `pkg/mcpserver`): 25-35% — orchestration wiring that would require real transports to test; no branching logic
- No dead code found. No architectural concerns surfaced.

## Next Steps (T11-A)

### Write Operations (~1-2 days)

Add mutation tools for all four domain kinds:
- `apply_agent`, `apply_skill`, `apply_mcp_server`, `apply_workflow` — create/update
- `delete_agent`, `delete_skill`, `delete_mcp_server`, `delete_workflow`
- Requires `CommandController` gRPC stubs and corresponding test doubles per domain

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
- "Continue with T11-A (write operations)" — mutation tools for all four kinds
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-10.md — T11-B (coverage report)
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-9.md  — T10
mcp-server/  — Implementation
mcp-server/internal/domains/uriutil.go  — URI parsing + building (kindToAuthority)
mcp-server/internal/domains/mcpservers/  — MCP server domain (new in T10)
mcp-server/internal/domains/search/tools.go  — search tool with resource_uri enrichment
client-apps/cli/cmd/stigmer/root/mcp_server.go  — CLI embedding with config bridging
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
