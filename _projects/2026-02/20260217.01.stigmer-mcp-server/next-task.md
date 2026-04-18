# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, MCP servers, and workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, MCP servers, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 19, 2026 — T11-A (Write Operations) — COMPLETE
**Current Task**: All tasks complete — project DONE
**Status**: T01 ✅ | T02 ✅ | T03 ✅ | T04 ✅ | T05 ✅ | T06 ✅ | T07 ✅ | T08 ✅ | T09 ✅ | T10 ✅ | T11-B ✅ | T11-A ✅

## Session Progress (2026-02-19, Session 11)

**T11-A — Write Operations (Complete)**

All 7 mutation tools implemented and wired. MCP server now exposes 12 tools total.

**New tools:**

| Tool | RPC | Pattern |
|---|---|---|
| `apply_agent` | `AgentCommandController.Apply(Agent)` | Full resource JSON → apply |
| `apply_mcp_server` | `McpServerCommandController.Apply(McpServer)` | Full resource JSON → apply |
| `apply_workflow` | `WorkflowCommandController.Apply(Workflow)` | Full resource JSON → apply |
| `delete_agent` | `AgentCommandController.Delete(AgentId)` | org+slug → GetByReference → delete |
| `delete_mcp_server` | `McpServerCommandController.Delete(ApiResourceDeleteInput)` | org+slug → GetByReference → delete |
| `delete_skill` | `SkillCommandController.Delete(SkillId)` | org+slug → GetByReference → delete |
| `delete_workflow` | `WorkflowCommandController.Delete(WorkflowId)` | org+slug → GetByReference → delete |

**apply_skill not implemented** — `SkillCommandController.push` requires binary ZIP artifact (`bytes artifact`), which is incompatible with MCP text-based tool arguments. Deferred until backend adds a text-based skill mutation RPC.

**Changes delivered:**

| Item | Description |
|---|---|
| T11-A-1 | `UnmarshalJSON` + `UnmarshalOptions` in `domains/jsonutil.go` |
| T11-A-2 | `agents/apply.go`, `apply_tool.go`, `apply_tool_test.go` |
| T11-A-3 | `agents/delete.go`, `delete_tool.go`, `delete_tool_test.go` |
| T11-A-4 | `mcpservers/apply.go`, `apply_tool.go`, `apply_tool_test.go` |
| T11-A-5 | `mcpservers/delete.go`, `delete_tool.go`, `delete_tool_test.go` |
| T11-A-6 | `workflows/apply.go`, `apply_tool.go`, `apply_tool_test.go` |
| T11-A-7 | `workflows/delete.go`, `delete_tool.go`, `delete_tool_test.go` |
| T11-A-8 | `skills/delete.go`, `delete_tool.go`, `delete_tool_test.go` |
| T11-A-9 | `server.go` — tool count 5 → 12 |

**Final tool inventory (12 tools):**
- Read: `search`, `get_agent`, `get_mcp_server`, `get_skill`, `get_workflow`
- Apply: `apply_agent`, `apply_mcp_server`, `apply_workflow`
- Delete: `delete_agent`, `delete_mcp_server`, `delete_skill`, `delete_workflow`

## Next Steps

The MCP server project backlog is **exhausted**. Possible follow-on work:

1. **Integration with Stigmer Cloud** — project `20260218.01.stigmer-planton-integration`
2. **Proto-to-MCP codegen exploration** — research at `_projects/2026-02/20260217.01.stigmer-mcp-server/research/20260219.160000.proto-to-mcp-server-codegen/`
3. **Smoke test against live stigmer-server** — validate apply/delete tools end-to-end against a real running backend
4. **apply_skill via inline SKILL.md** — if backend adds a text-based skill mutation RPC

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
| Deserialization | `protojson` with `DiscardUnknown: true` | AI clients may produce extra fields; lenient parsing avoids brittle errors |
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
| Apply input | Full resource JSON string | Decouples tool schema from proto evolution; AI can construct from get_* output |
| Delete input | org+slug (fetch-then-delete) | Users know resources by slug, not UUID; extra round-trip is negligible |
| CLI embed | Foreground command, not daemon | MCP server is stateless; no lifecycle management needed |

## Quick Resume Commands

No active tasks remain. If resuming:
- "Show project status" — full overview
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Start smoke test against live server" — validate end-to-end

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-11.md — T11-A (write ops)
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-10.md — T11-B (coverage report)
mcp-server/  — Implementation
mcp-server/internal/domains/jsonutil.go  — JSON marshal + unmarshal utilities
mcp-server/internal/domains/agents/  — Agent domain (get, apply, delete)
mcp-server/internal/domains/mcpservers/  — MCP server domain (get, apply, delete)
mcp-server/internal/domains/skills/  — Skill domain (get, delete — no apply)
mcp-server/internal/domains/workflows/  — Workflow domain (get, apply, delete)
mcp-server/internal/server/server.go  — Tool + resource registration
client-apps/cli/cmd/stigmer/root/mcp_server.go  — CLI embedding with config bridging
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
