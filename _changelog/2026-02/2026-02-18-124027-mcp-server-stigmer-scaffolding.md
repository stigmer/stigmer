# MCP Server for Stigmer — Architecture & Core Implementation

**Date**: February 18, 2026

## Summary

Designed and implemented `mcp-server-stigmer`, a Model Context Protocol server that gives AI coding assistants (Cursor, Claude Desktop, Windsurf) direct access to Stigmer's agents, skills, and workflows. Built on the official `modelcontextprotocol/go-sdk` v1.3.0, the server exposes four tools backed by stigmer-server's gRPC API, supports both STDIO and Streamable HTTP transports, and integrates cleanly into the Stigmer monorepo as a first-class Go module.

## Problem Statement

AI coding assistants had no way to discover or inspect resources on the Stigmer platform. Developers working in Cursor or Claude Desktop had to context-switch to a browser or the CLI to look up agent configurations, skill definitions, or workflow specs — then manually paste that information back into their conversation.

### Pain Points

- No machine-readable interface between AI tools and the Stigmer platform
- No way to search or list agents/skills/workflows from within an IDE chat
- CLI (`stigmer agent get`) requires a separate terminal context switch
- Agents writing code that integrates Stigmer resources had no way to introspect those resources in-context

## Solution

A standalone MCP server (`mcp-server-stigmer`) placed at the repository root as a new Go module. The server implements the MCP 2025-06-18 specification using the official Go SDK, registers four well-designed tools over the Stigmer gRPC API, and handles both STDIO (local subprocess) and Streamable HTTP (remote/shared) transports with proper per-request authentication.

## Implementation Details

### Repository Structure

```
mcp-server/
├── cmd/mcp-server-stigmer/main.go           # Entry point, transport switch, graceful shutdown
├── internal/
│   ├── config/config.go                     # 5 env vars, validation, sensible defaults
│   ├── auth/credentials.go                  # Context-based API key + gRPC PerRPCCredentials
│   ├── grpc/client.go                       # Connection factory (auto TLS on :443)
│   ├── server/server.go                     # MCP server init + tool registration + STDIO
│   ├── server/http.go                       # Streamable HTTP + auth middleware + /health
│   └── domains/
│       ├── jsonutil.go                      # Shared protojson serialization
│       ├── search/tools.go                  # search tool
│       ├── agents/tools.go                  # get_agent tool
│       ├── skills/tools.go                  # get_skill tool
│       └── workflows/tools.go               # get_workflow tool
├── Makefile                                 # build / test / docker-build / lint / fmt / clean
├── Dockerfile                               # Multi-stage, alpine runtime, non-root user
└── README.md                                # Cursor/Claude Desktop setup, config reference
```

### Tool Surface (4 tools)

| Tool | Backend RPC | Key Inputs |
|---|---|---|
| `search` | `SearchService.search` | kinds, query, org, page_size, page_num, exclude_public |
| `get_agent` | `AgentQueryController.getByReference` | org, slug |
| `get_skill` | `SkillQueryController.getByReference` | org, slug, version (optional) |
| `get_workflow` | `WorkflowQueryController.getByReference` | org, slug |

The `search` tool is the most powerful: with `kinds=[]` and a `query` it discovers across all resource types; with `kinds=["agent"]` and no query it lists all accessible agents; with both set it performs scoped full-text search. This single tool replaces what would have been three separate `list_*` tools.

### Key Architectural Decisions

**Context-based API key propagation** — The official MCP Go SDK passes `context.Context` all the way through from the transport to every tool handler. This eliminates the global-mutex API key workaround used in older community SDKs. In STDIO mode the key is injected into the base context at `server.Run` time; in HTTP mode it is extracted from the `Authorization: Bearer` header per-request by an HTTP middleware.

**Convention-based TLS** — The gRPC client factory uses the endpoint string to determine transport security: port `:443` gets system-CA TLS, everything else gets insecure credentials. This is the same convention as the Stigmer CLI and requires zero configuration for the two expected deployment targets (localhost dev, `api.stigmer.ai:443` production).

**Unified search over domain-specific list tools** — Discovery during implementation showed that `AgentQueryController`, `SkillQueryController`, and `WorkflowQueryController` expose only `get(ID)` and `getByReference(org/slug)` — no list or find operations. `SearchService.search` is the correct unified primitive and yields a richer result (full-text search, pagination, cross-kind discovery, relevance scores) than per-domain list tools would have.

**Shared `domains/jsonutil.go`** — All four tool handlers serialize protobuf responses to JSON using the same `protojson.MarshalOptions` instance (`UseProtoNames: true`, `EmitUnpopulated: false`, `Multiline: true`). This ensures consistent field naming (snake_case proto names), proper RFC 3339 timestamp rendering, and clean output for AI consumption.

**Dockerfile build context** — The `replace` directive in `go.mod` points to `../apis/stubs/go`. The Dockerfile must therefore be built from the repository root with `docker build -f mcp-server/Dockerfile .` so both `mcp-server/` and `apis/stubs/go/` are in scope.

### Monorepo Integration

- `go.work`: `./mcp-server` added as a workspace module
- Root `Makefile`: `mcp-server` included in `setup`, `test` (step 6/8), `test-all-go`, `lint`, `coverage`
- `.gitignore`: `mcp-server/mcp-server-stigmer` added (prevents committing the binary that `go build ./cmd/mcp-server-stigmer` drops in CWD)

## Benefits

**For AI coding assistants** — Can now discover agents (`search` with `kinds=["agent"]`), look up a specific agent's full configuration (`get_agent org=acme slug=code-reviewer`), check a skill's implementation details including version (`get_skill org=stigmer slug=web-search version=stable`), and inspect workflow definitions — all without leaving the IDE chat.

**For developers** — Zero context switching when building integrations with Stigmer resources. The AI assistant has the same information the developer would get from `stigmer agent get acme/code-reviewer`.

**For the platform** — Sets the foundation for extending the MCP surface. The four-tool design scales cleanly: adding `get_mcp_server`, command tools (create/update/delete), or resource subscriptions follows the same patterns without refactoring the core.

**Code quality** — `go build`, `go vet`, and `gofmt` all pass cleanly. No dead code. No global state. No workarounds.

## Impact

- **Cursor, Claude Desktop, Windsurf** users can configure `mcp-server-stigmer` in their MCP client and immediately gain access to the full Stigmer resource catalog
- STDIO mode: zero infrastructure required (binary runs as a subprocess)
- HTTP mode: single Docker container serves multiple users with per-request Bearer auth
- The server is stateless — the same `mcp.Server` instance safely handles STDIO and HTTP simultaneously

## Related Work

- `T01_0_plan.md` — Full architecture decision log for this project
- `checkpoints/2026-02-18-session-1.md` — Detailed session notes including key code patterns and open questions
- **Next**: T03 (Testing) — unit tests for config, auth, search kind parsing, and mock-gRPC integration tests for tool handlers

---

**Status**: ✅ Production Ready (pending T03 tests)
**Timeline**: T01 + T02 completed in a single session (February 18, 2026)
