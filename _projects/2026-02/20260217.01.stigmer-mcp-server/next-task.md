# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 18, 2026 — T05 (README Update + MCP Resource Templates) — COMPLETE
**Current Task**: T06 — Ready to pick (see candidates below)
**Status**: T01 ✅ Complete | T02 ✅ Complete | T03 ✅ Complete | T04 ✅ Complete | T05 ✅ Complete | T06 Pending

## Session Progress (2026-02-18, Session 4)

**T05 — README Update + MCP Resource Templates (Complete)**

70 tests across 10 packages, all passing under `-race` and `go vet`.

**Changes delivered:**

| Item | Description |
|---|---|
| T05-A | README fully updated: new env vars (`STIGMER_MCP_LOG_FORMAT`, `STIGMER_MCP_LOG_LEVEL`), Logging section, Graceful Shutdown section, build version injection note, updated Architecture map |
| T05-B.1 | `internal/domains/uriutil.go`: `ParseResourceURI()` with 10 unit tests |
| T05-B.2 | Shared `Fetch()` extracted into `fetch.go` per domain; tool handlers slimmed to ~5 lines |
| T05-B.3 | Resource templates: `stigmer://agents/{org}/{slug}`, `stigmer://skills/{org}/{slug}`, `stigmer://workflows/{org}/{slug}` with 4 integration tests each |
| T05-B.4 | `registerResources()` wired into `server.go` `New()` alongside `registerTools()` |

**New files:**
- `mcp-server/internal/domains/uriutil.go` + `uriutil_test.go`
- `mcp-server/internal/domains/agents/fetch.go` + `resources.go` + `resources_test.go`
- `mcp-server/internal/domains/skills/fetch.go` + `resources.go` + `resources_test.go`
- `mcp-server/internal/domains/workflows/fetch.go` + `resources.go` + `resources_test.go`

## Next Steps (T06 Candidates — pick one)

### Option A: Versioned Skill Resources (quick win, ~1 hour)

The current `stigmer://skills/{org}/{slug}` template always returns the latest version. Add:
- `stigmer://skills/{org}/{slug}/{version}` resource template
- Version segment parsed from URI (4-segment path instead of 2)
- Requires a small extension to `ParseResourceURI` or a new `ParseResourceURIWithVersion` function

### Option B: Write Operations (bigger scope, ~1-2 days)

Add mutation tools:
- `apply_agent`, `apply_skill`, `apply_workflow` — create/update
- `delete_agent`, `delete_skill`, `delete_workflow`
- Requires `CommandController` gRPC stubs to be available and their test doubles to be mockable

### Option C: CLI Embedding (~half day)

Expose the MCP server as a `stigmer mcp-server start` CLI subcommand:
- Import `mcp-server/internal/server` directly from the CLI package (same Go module)
- Same binary handles both CLI and MCP server modes
- Allows `stigmer mcp-server start` as a discoverable entry point

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
| Resources | Templates only (no static list resources) | `search` tool handles discovery; static list resources can't paginate or filter |
| Fetch abstraction | `Fetch()` in `fetch.go` per domain | Single implementation shared by tool and resource handlers |
| Skill resource version | Latest only for `{org}/{slug}` template | No current use case for pinned-version resource reads |

## Quick Resume Commands

When starting the next session:
- "Continue with T06 Option A (versioned skill resources)" — quick feature task
- "Continue with T06 Option B (write operations)" — larger feature task
- "Continue with T06 Option C (CLI embedding)" — integration task
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-1.md  — T01+T02
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-2.md  — T03
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-3.md  — T04
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-4.md  — T05
mcp-server/  — Implementation (26 source files + 15 test files)
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
