# Next Task: 20260217.01.stigmer-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.01.stigmer-mcp-server

**Description**: Design and implement an MCP (Model Context Protocol) server for Stigmer that exposes Stigmer resources — agents, skills, workflows — to AI coding assistants and other MCP-compatible clients.
**Goal**: Create an MCP server that enables AI tools (Cursor, Claude Desktop, etc.) to discover and interact with Stigmer resources, starting with agents, skills, and workflows, with a clear extension path for projects, executions, and build artifacts.
**Tech Stack**: Go, official `modelcontextprotocol/go-sdk`, gRPC (Stigmer API), Protocol Buffers
**Location**: `mcp-server/` at the repository root (not under `backend/services/`)

## Current Status

**Last Session**: February 19, 2026 — T08 (Versioned Skill Resources) — COMPLETE
**Current Task**: T09 — Ready to pick (see candidates below)
**Status**: T01 ✅ | T02 ✅ | T03 ✅ | T04 ✅ | T05 ✅ | T06 ✅ | T07 ✅ | T08 ✅ | T09 Pending

## Session Progress (2026-02-19, Session 7)

**T08 — Versioned Skill Resources (Complete)**

All 11 MCP server packages passing under `-race`. `go vet` clean.

**Changes delivered:**

| Item | Description |
|---|---|
| T08-A | `ParseVersionedResourceURI(uri) (org, slug, version, err)` in `uriutil.go` — accepts 2 or 3 path segments; existing `ParseResourceURI` untouched |
| T08-B | 14 new table-driven tests for `ParseVersionedResourceURI` in `uriutil_test.go` |
| T08-C | `VersionedTemplate()` + `VersionedResourceHandler()` in `skills/resources.go` — handler passes parsed version to existing `Fetch()` |
| T08-D | 5 new tests: template metadata, happy path, latest fallback, malformed URI, gRPC NotFound |
| T08-E | Registered versioned template in `server.go`; updated slog count 3→4 |
| T08-F | Updated `README.md` Resources table and Architecture section |

**Key design decisions:**

- Two templates, not one — `stigmer://skills/{org}/{slug}` (latest) and `stigmer://skills/{org}/{slug}/{version}` (specific). Shorter URI stays canonical for the common case; both appear in `ListResourceTemplates`.
- `ParseVersionedResourceURI` accepts 2 or 3 path segments; `version=""` when 2 segments present (latest fallback). Existing `ParseResourceURI` untouched. New function is positioned to serve agents/workflows when they add versioning.
- URI anatomy: in `stigmer://skills/acme/slug/stable`, Go's `url.Parse` produces `Host="skills"` (authority) and `Path="/acme/slug/stable"` (3 segments). Kind lives in Host, not path.
- Zero changes to existing code paths — purely additive.

## Next Steps (T09 Candidates — pick one)

### Option A: Write Operations (bigger scope, ~1-2 days)

Add mutation tools:
- `apply_agent`, `apply_skill`, `apply_workflow` — create/update
- `delete_agent`, `delete_skill`, `delete_workflow`
- Requires `CommandController` gRPC stubs and corresponding test doubles

### Option B: Versioned Resource Templates for Agents and Workflows (~1 hour)

Apply the same `ParseVersionedResourceURI` pattern to agents and workflows:
- `stigmer://agents/{org}/{slug}/{version}`
- `stigmer://workflows/{org}/{slug}/{version}`
- The parser already supports this; only `VersionedTemplate()` + `VersionedResourceHandler()` per domain are needed, plus registration and tests

### Option C: Search Result URIs (~30 min)

Ensure the `search` tool response includes resource URIs that clients can pass directly to resource handlers — bridging the discovery-to-read workflow end-to-end.

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
| Fetch abstraction | `Fetch()` in `fetch.go` per domain | Single implementation shared by tool and resource handlers |
| CLI embed | Foreground command, not daemon | MCP server is stateless; no lifecycle management needed |

## Quick Resume Commands

When starting the next session:
- "Continue with T09 Option A (write operations)" — mutation tools
- "Continue with T09 Option B (versioned resources for agents and workflows)" — quick follow-on to T08
- "Continue with T09 Option C (search result URIs)" — bridge discovery to read
- "Show test coverage" — run `go test -coverprofile` to see numbers
- "Show project status" — get full overview

## Essential Files

```
_projects/2026-02/20260217.01.stigmer-mcp-server/tasks/T01_0_plan.md  — Architecture decisions
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-7.md  — T08
_projects/2026-02/20260217.01.stigmer-mcp-server/checkpoints/2026-02-19-session-6.md  — T07
mcp-server/  — Implementation
mcp-server/internal/domains/uriutil.go  — URI parsing (both parsers)
mcp-server/internal/domains/skills/  — Skills domain (tool + resource handlers)
client-apps/cli/cmd/stigmer/root/mcp_server.go  — CLI embedding with config bridging
```

---

*To resume: drag this file into chat — `@_projects/2026-02/20260217.01.stigmer-mcp-server/next-task.md`*
