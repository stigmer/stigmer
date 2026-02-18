# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 18, 2026 — T01 (Architecture & Design) + T02 (Scaffolding & Core Implementation) — COMPLETE
**Current Task**: T03 (Testing) — Ready to start
**Status**: T01 ✅ Complete | T02 ✅ Complete | T03 Pending

## Session Progress (2026-02-18)

Two full tasks completed in this session:

**T01 — Architecture & Design (Complete)**
- Selected official `modelcontextprotocol/go-sdk` v1.3.0 over the community mcp-go SDK
- Decided on `mcp-server/` at repository root (not `backend/services/`)
- Designed 4-tool surface: `search`, `get_agent`, `get_skill`, `get_workflow`
- Key discovery: Agent/Skill/Workflow query controllers lack `list` RPCs — `SearchService.search` is the correct unified list+search primitive
- Chose STDIO + Streamable HTTP dual transport
- Full plan written in `tasks/T01_0_plan.md`

**T02 — Scaffolding & Core Implementation (Complete)**
- Full reimplementation done with claude-opus-4.6 (previous run was with Auto model and was reverted)
- All 15 source files created; `go build`, `go vet`, `gofmt` all pass cleanly
- Zero dead code, zero technical debt

**Files Created (mcp-server/):**
- `go.mod` — module `github.com/stigmer/stigmer/mcp-server`, replace directive for local stubs
- `cmd/mcp-server-stigmer/main.go` — entry point with transport switch + graceful shutdown
- `internal/config/config.go` — 5 env vars, validation, sensible defaults
- `internal/auth/credentials.go` — context-based API key propagation + gRPC PerRPCCredentials
- `internal/grpc/client.go` — connection factory (auto TLS on :443, insecure otherwise)
- `internal/domains/jsonutil.go` — shared protojson marshaling
- `internal/domains/search/tools.go` — `search` tool via `SearchService.search`
- `internal/domains/agents/tools.go` — `get_agent` tool via `AgentQueryController.getByReference`
- `internal/domains/skills/tools.go` — `get_skill` tool (with version support)
- `internal/domains/workflows/tools.go` — `get_workflow` tool
- `internal/server/server.go` — MCP server init + tool registration + STDIO transport
- `internal/server/http.go` — Streamable HTTP handler + Bearer auth middleware + health endpoint
- `Makefile` — build / test / docker-build / lint / fmt / clean
- `Dockerfile` — multi-stage, non-root, health check (build from repo root)
- `README.md` — setup for Cursor/Claude Desktop, config reference, architecture

**Files Modified:**
- `go.work` — added `./mcp-server`
- `Makefile` (root) — added mcp-server to setup, test (1/8), test-all-go, lint, coverage
- `.gitignore` — added `mcp-server/mcp-server-stigmer` to prevent stray binary commits

## Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SDK | `modelcontextprotocol/go-sdk` v1.3.0 | Official, typed handlers, native Streamable HTTP |
| Location | `mcp-server/` at repo root | Neither client-app nor backend service; client-facing infrastructure |
| Auth (STDIO) | Context-injected at server.Run() base ctx | SDK propagates context to all tool handlers — no global state |
| Auth (HTTP) | Bearer token extracted per-request in middleware | Each user brings their own key |
| List tools | Unified `search` via `SearchService.search` | Domain controllers have no list RPCs; search covers list+discover |
| Serialization | `protojson` with `UseProtoNames: true` | Clean JSON, RFC 3339 timestamps, no manual struct mapping |

## Next Steps (T03: Testing)

1. Write unit tests for `internal/config` — validation edge cases, missing API key scenarios
2. Write unit tests for `internal/auth` — context key round-trip, missing key errors
3. Write unit tests for `internal/domains/search` — kind parsing, invalid kinds, empty kinds
4. Write integration test scaffolding (mock gRPC server) for tool handlers
5. Add test coverage to root Makefile `coverage` target

## Quick Resume Commands

When starting the next session:
- "Continue with T03" — start writing tests
- "Show T02 files" — review what was implemented
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-1.md  — Session notes
mcp-server/  — Implementation (all 15 source files)
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
