# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 19, 2026 — T07 (Config Bridging) — COMPLETE
**Current Task**: T08 — Ready to pick (see candidates below)
**Status**: T01 ✅ | T02 ✅ | T03 ✅ | T04 ✅ | T05 ✅ | T06 ✅ | T07 ✅ | T08 Pending

## Session Progress (2026-02-19, Session 6)

**T07 — Config Bridging (Complete)**

All 11 MCP server packages passing under `-race`. `go vet` clean on both modules.

**Changes delivered:**

| Item | Description |
|---|---|
| T07-A | `auth.APIKey(ctx) string` — new non-error variant for fetch handlers targeting either auth or no-auth backends |
| T07-B | `grpc.NewConnection` — conditionally attaches `PerRPCCredentials` only when `apiKey != ""` |
| T07-C | `config.Validate()` — removed API key requirement for STDIO/BOTH transport |
| T07-D | 4 fetch call sites (agents, skills, workflows, search) — switched from `GetAPIKey` to `APIKey` |
| T07-E | `applyCLIConfig()` + `applyCLIConfigDefaults()` in `mcp_server.go` — bridges `~/.stigmer/config.yaml` into MCP config |
| T07-F | `mcp-server/README.md` — new "Configuration Resolution" section; simplified zero-config mcp.json example |
| T07-G | ~24 test updates: 3 new auth tests, 1 new grpc test, 7 new CLI config bridging tests, updated 5 existing tests |

**Key design decisions:**

- Auth is a property of the target, not the tool (matches kubectl, Pulumi, Terraform, MCP spec)
- Layer 1 (MCP server core) has no knowledge of CLI config — pure optional-auth behavior
- Layer 2 (CLI command) reads `~/.stigmer/config.yaml` and bridges; standalone binary unaffected
- `applyCLIConfig` is a pure function for testability; `applyCLIConfigDefaults` is the I/O wrapper
- Local backend → `localhost:7234` (daemon port); cloud backend → reads endpoint and token
- Precedence: CLI flags > env vars > `~/.stigmer/config.yaml` > MCP defaults

**User stories now working:**

| Scenario | Before | After |
|---|---|---|
| `stigmer mcp-server` with local backend | FAILS: "API key required" | Works: connects to `localhost:7234`, no auth |
| `stigmer mcp-server` with cloud backend | FAILS: "API key required" | Works: reads token and endpoint from `~/.stigmer/config.yaml` |
| `mcp-server-stigmer` with env vars | Works | Works (unchanged) |

## Next Steps (T08 Candidates — pick one)

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
| Fetch abstraction | `Fetch()` in `fetch.go` per domain | Single implementation shared by tool and resource handlers |
| CLI embed | Foreground command, not daemon | MCP server is stateless; no lifecycle management needed |

## Quick Resume Commands

When starting the next session:
- "Continue with T08 Option A (versioned skill resources)" — quick feature task
- "Continue with T08 Option B (write operations)" — larger feature task
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-6.md  — T07
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-5.md  — T06
mcp-server/  — Implementation
client-apps/cli/cmd/stigmer/root/mcp_server.go  — CLI embedding with config bridging
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
