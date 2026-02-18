# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 19, 2026 — T06 (CLI Embedding) — COMPLETE
**Current Task**: T07 — Ready to pick (see candidates below)
**Status**: T01 ✅ Complete | T02 ✅ Complete | T03 ✅ Complete | T04 ✅ Complete | T05 ✅ Complete | T06 ✅ Complete | T07 Pending

## Session Progress (2026-02-19, Session 5)

**T06 — CLI Embedding (Complete)**

84 tests across 11 packages, all passing under `-race` and `go vet`.

**Changes delivered:**

| Item | Description |
|---|---|
| T06-A | `mcp-server/pkg/mcpserver/` — new public API package: `Config`, `DefaultConfig()`, `Run()` |
| T06-B | `mcp-server/cmd/mcp-server-stigmer/main.go` — refactored to thin wrapper (~50 lines, down from ~120) |
| T06-C | `client-apps/cli/cmd/stigmer/root/mcp_server.go` — Cobra `mcp-server` command with 6 flags |
| T06-D | `client-apps/cli/cmd/stigmer/root.go` — command registered under root |
| T06-E | `client-apps/cli/go.mod` — added `replace` directives for all workspace-local modules (pre-existing gap fixed as a byproduct) |
| T06-F | `mcp-server/README.md` — "Running via CLI" section + dual Cursor `mcp.json` examples + architecture map updated |
| T06-G | 18 new tests (14 in `pkg/mcpserver/`, 4 in CLI root package) |

**New files:**
- `mcp-server/pkg/mcpserver/config.go` + `config_test.go`
- `mcp-server/pkg/mcpserver/run.go` + `run_test.go`
- `client-apps/cli/cmd/stigmer/root/mcp_server.go` + `mcp_server_test.go`

**Key design decisions:**
- Public API surface is minimal: just `Config`, `DefaultConfig()`, `Run()` — callers never import `internal/`
- `mcp-server/internal/config.Validate()` and `ParseLogLevel()` exported (lowercase → uppercase) to enable clean conversion from public `Config` to internal `Config` without duplicating logic
- Flags override env vars; unset flags fall through to env-var defaults — consistent with the rest of the CLI
- `stigmer mcp-server` is a **foreground** command, not a daemon — no start/stop/status subcommands (unlike `stigmer server`)

## Next Steps (T07 Candidates — pick one)

### Option A: Versioned Skill Resources (quick win, ~1 hour)

The current `stigmer://skills/{org}/{slug}` template always returns the latest version. Add:
- `stigmer://skills/{org}/{slug}/{version}` resource template
- Version segment parsed from URI (4-segment path instead of 2)
- Requires a small extension to `ParseResourceURI` or a new helper function

### Option B: Write Operations (bigger scope, ~1-2 days)

Add mutation tools:
- `apply_agent`, `apply_skill`, `apply_workflow` — create/update
- `delete_agent`, `delete_skill`, `delete_workflow`
- Requires `CommandController` gRPC stubs and corresponding test doubles

### Option C: Config Bridging (~half day)

Bridge `~/.stigmer/config.yaml` into the MCP server when launched via `stigmer mcp-server`:
- If `STIGMER_API_KEY` is unset, fall back to `config.Backend.Cloud.Token`
- If `STIGMER_SERVER_ADDRESS` is unset, fall back to cloud endpoint from config
- Improves UX for users already authenticated via `stigmer backend`

## Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SDK | `modelcontextprotocol/go-sdk` v1.3.0 | Official, typed handlers, native Streamable HTTP |
| Location | `mcp-server/` at repo root | Neither client-app nor backend service; client-facing infrastructure |
| Public API | `pkg/mcpserver/` | Minimal surface: Config + DefaultConfig + Run; callers never import internal/ |
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
| CLI embed | Foreground command, not daemon | MCP server is stateless; no lifecycle management needed |

## Quick Resume Commands

When starting the next session:
- "Continue with T07 Option A (versioned skill resources)" — quick feature task
- "Continue with T07 Option B (write operations)" — larger feature task
- "Continue with T07 Option C (config bridging)" — UX improvement
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-1.md  — T01+T02
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-2.md  — T03
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-3.md  — T04
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-4.md  — T05
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-5.md  — T06
mcp-server/  — Implementation (28 source files + 17 test files)
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
