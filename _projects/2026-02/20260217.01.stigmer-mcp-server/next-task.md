# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 18, 2026 — T03 (Testing) — COMPLETE
**Current Task**: T04 (Observability & Hardening) — Ready to start
**Status**: T01 ✅ Complete | T02 ✅ Complete | T03 ✅ Complete | T04 Pending

## Session Progress (2026-02-18, Session 2)

**T03 — Testing (Complete)**

48 tests across 8 packages, all passing under `-race` and `go vet`.

**Test files created:**

| File | Tests | Coverage |
|---|---|---|
| `internal/config/config_test.go` | 12 | `LoadFromEnv`, validation, transport normalization, defaults, auth flag |
| `internal/auth/credentials_test.go` | 6 | Context round-trip, empty key, nested contexts, `TokenAuth` |
| `internal/grpc/client_test.go` | 3 | TLS vs insecure selection, empty endpoint behavior |
| `internal/domains/search/tools_test.go` | 17 | `parseKinds` (8 cases) + handler integration (9 cases) |
| `internal/domains/agents/tools_test.go` | 4 | Handler integration: success, missing key, NotFound, tool metadata |
| `internal/domains/skills/tools_test.go` | 5 | Handler integration: success, version forwarding, missing key, NotFound, tool metadata |
| `internal/domains/workflows/tools_test.go` | 4 | Handler integration: success, missing key, NotFound, tool metadata |
| `internal/server/http_test.go` | 12 | `extractBearerToken` (7 cases), `healthHandler`, `authMiddleware` (3 cases), `statusWriter` |
| `internal/testutil/grpctest.go` | — | Shared helper: gRPC server on `localhost:0` with `t.Cleanup` shutdown |

**Architecture decision during T03:**
- Integration test strategy: real gRPC server + mock service implementations embedding `Unimplemented*Server` proto structs. Zero production code changes required.
- `extractText` helpers duplicated per-package (test-only) rather than cross-package test dependencies.
- `testutil.StartGRPCServer` extracted once because it was identical across all 4 domain test files.
- T03.7 (root Makefile) was already correct — `mcp-server` was present in all targets.

## Next Steps (T04: Observability & Hardening)

1. **Structured logging** — Replace `log.Printf` calls with a structured logger (`slog`, Go 1.21+); add request-id correlation through the MCP context
2. **Error classification** — Map gRPC status codes (NotFound, PermissionDenied, etc.) to meaningful MCP error messages rather than raw gRPC errors
3. **Graceful HTTP shutdown** — `http.ListenAndServe` blocks and ignores context cancellation; wire in `http.Server.Shutdown` on signal
4. **Connection health** — Add gRPC connectivity check / dial timeout so bad server addresses fail fast instead of hanging
5. **Build version in Makefile** — Pass `-ldflags` to inject `buildVersion` from `git describe` in local builds (Dockerfile already does this)

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

## Quick Resume Commands

When starting the next session:
- "Continue with T04" — start observability & hardening
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-1.md  — T01+T02 session notes
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-18-session-2.md  — T03 session notes
mcp-server/  — Implementation (15 source files + 9 test files)
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
