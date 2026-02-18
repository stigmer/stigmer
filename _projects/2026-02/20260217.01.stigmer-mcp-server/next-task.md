# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 18, 2026 — T04 (Observability & Hardening) — COMPLETE
**Current Task**: T05 — Ready to pick (see candidates below)
**Status**: T01 ✅ Complete | T02 ✅ Complete | T03 ✅ Complete | T04 ✅ Complete | T05 Pending

## Session Progress (2026-02-18, Session 3)

**T04 — Observability & Hardening (Complete)**

58 tests across 9 packages, all passing under `-race` and `go vet`.

**Changes delivered:**

| Item | Description |
|---|---|
| T04.5 | `make build` now injects `buildVersion` via `-ldflags="-X ...buildVersion=$(VERSION)"` from `git describe` |
| T04.1 | Structured logging via `log/slog`; all 14 `log.*` call sites migrated; all output to stderr; two new env vars: `STIGMER_MCP_LOG_FORMAT` (text/json) and `STIGMER_MCP_LOG_LEVEL` (debug/info/warn/error) |
| T04.3 | Graceful HTTP shutdown: `ServeHTTP(ctx)` now accepts context; `http.Server.Shutdown` called with 5s grace; `ReadHeaderTimeout: 10s` added for slowloris protection |
| T04.2 | gRPC error classification: `internal/domains/rpcerr.go` maps 7 gRPC codes to user-friendly messages; raw error logged at WARN for operators |
| T04.4 | `DefaultRPCTimeout = 30s` constant in `internal/grpc/`; all 4 domain handlers wrap RPC calls with `context.WithTimeout` |

**New files:**
- `mcp-server/internal/domains/rpcerr.go`
- `mcp-server/internal/domains/rpcerr_test.go`
- `mcp-server/internal/config/config_test.go` (10 new tests)

## Next Steps (T05 Candidates — pick one)

### Option A: README Update (quick win, ~1 hour)
The README still documents the old `log` behavior and is missing:
- `STIGMER_MCP_LOG_FORMAT` and `STIGMER_MCP_LOG_LEVEL` env var documentation
- Updated request log format (structured, with request_id)
- Graceful shutdown behavior notes

### Option B: MCP Resources (planned, ~half day)
Expose agents, skills, and workflows as URI-addressable MCP Resources:
- Register `stigmer://agents/{org}/{slug}` etc. via `mcp.AddResource`
- Enables MCP clients to browse resources without calling tools
- Already planned in T01 architecture

### Option C: Write Operations (bigger scope, ~1-2 days)
Add mutation tools:
- `apply_agent`, `apply_skill`, `apply_workflow` — create/update
- `delete_agent`, `delete_skill`, `delete_workflow`
- Requires `CommandController` gRPC stubs to be available

## Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SDK | `modelcontextprotocol/go-sdk` v1.3.0 | Official, typed handlers, native Streamable HTTP |
| Location | `mcp-server/` at repo root | Neither client-app nor backend service; client-facing infrastructure |
| Auth (STDIO) | Context-injected at server.Run() base ctx | SDK propagates context to all tool handlers — no global state |
| Auth (HTTP) | Bearer token extracted per-request in middleware | Each user brings their own key |
| List tools | Unified `search` via `SearchService.search` | Domain controllers have no list RPCs; search covers list+discover |
| Serialization | `protojson` with `UseProtoNames: true` | Clean JSON, RFC 3339 timestamps, no manual struct mapping |
| Integration tests | Real gRPC server + embedded Unimplemented* mocks | Zero production code changes; validates full handler path |
| Logging | `log/slog` to stderr | Stdlib, structured, stderr-only (stdout reserved for STDIO transport) |
| Error messages | `domains.RPCError(err, resourceDesc)` | Classifies gRPC codes into user-friendly messages; logs raw error |
| RPC timeout | `DefaultRPCTimeout = 30s` via `context.WithTimeout` | Fails fast on unreachable servers; avoids 2min TCP timeout hangs |

## Quick Resume Commands

When starting the next session:
- "Continue with T05 Option A (README update)" — documentation task
- "Continue with T05 Option B (MCP Resources)" — feature task
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-1.md  — T01+T02 session notes
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-2.md  — T03 session notes
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-3.md  — T04 session notes
mcp-server/  — Implementation (15 source files + 11 test files)
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
