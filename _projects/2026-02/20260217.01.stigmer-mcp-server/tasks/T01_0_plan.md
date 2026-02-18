# Task T01: Architecture & Design — Stigmer MCP Server

**Created**: 2026-02-17
**Updated**: 2026-02-17 (v2 — official Go SDK, language rationale, auth improvements)
**Status**: PENDING REVIEW
**Type**: Feature Development — Architecture & Design

> **This plan requires your review before execution.**

---

## Objective

Design the Stigmer MCP Server — a Model Context Protocol server that exposes Stigmer resources (agents, skills, workflows) to MCP-compatible AI tools (Cursor, Claude Desktop, Windsurf, etc.). This task covers the key architectural decisions, initial resource scope, transport strategy, authentication model, distribution options, and phased roadmap.

**Reference implementation:** `mcp-server-planton` at `/Users/suresh/scm/github.com/plantonhq/mcp-server-planton` — our proven Go MCP server that supports stdio + HTTP transports, per-user API key authentication, and domain-based tool organization. Planton currently uses the community `mark3labs/mcp-go` SDK; Stigmer will use the newer **official Anthropic Go SDK**.

---

## Decision 1: Repository Placement

### Option A: Inside the Stigmer Mono Repo (Recommended)

Place the MCP server as a new top-level component, e.g., `mcp-server/` alongside `client-apps/`, `backend/`, `sdk/`, etc.

**Pros:**
- Direct access to generated gRPC stubs in `apis/stubs/` — no separate dependency management
- Shared proto definitions evolve atomically with the MCP server
- Single CI/CD pipeline; when Stigmer APIs change, the MCP server builds and tests in the same commit
- Consistent versioning — MCP server version stays in lockstep with Stigmer releases
- Reuses existing build infrastructure (Bazel, Makefiles, etc.)
- Easy to embed the MCP server binary into the CLI later (same pattern as `stigmer-server`, `agent-runner`, `workflow-runner`)

**Cons:**
- Increases mono repo size (marginal — MCP server is lightweight)
- MCP server releases are tied to the mono repo release cycle
- Contributors interested only in MCP integration must clone the full repo

### Option B: Standalone Repository

Separate repo, e.g., `stigmer/mcp-server-stigmer` (following the `mcp-server-planton` naming pattern).

**Pros:**
- Independent release cycle
- Smaller repo for MCP-focused contributors
- Can publish as a standalone tool more naturally
- Follows the Planton pattern — `mcp-server-planton` is a standalone repo

**Cons:**
- Must depend on Stigmer API definitions externally (proto submodule or generated client package)
- Version drift risk — MCP server may lag behind API changes
- Duplicated CI/CD configuration
- Harder to embed into the CLI binary later
- More coordination overhead for breaking API changes

### Recommendation

**Option A — Mono Repo** is the better fit because:
1. The MCP server is a thin adapter over existing gRPC APIs — it doesn't have independent domain logic
2. Atomic updates when APIs change avoids version drift
3. Follows the established pattern (stigmer-server, agent-runner, workflow-runner all live in the mono repo)
4. The Planton MCP server is standalone because Planton's APIs are remote (buf.build managed) — Stigmer's APIs are local and co-evolving, so co-location makes more sense
5. Can always extract to a separate repo later if needed

**Proposed location:** `mcp-server/` at the repo root.

---

## Decision 2: Language Choice — Go

### Why Go over TypeScript or Python?

The MCP ecosystem spans three major languages. Here's how they compare:

| Factor | TypeScript | Python | **Go** |
|---|---|---|---|
| **Official Anthropic SDK** | Yes (11.6K stars) | Yes (21.7K stars) | **Yes** (`modelcontextprotocol/go-sdk`, 3.9K stars, maintained with Google) |
| **NPX distribution** | Native (`npx @scope/pkg`) | No | No (but Docker, `go install`, binary releases) |
| **Single binary** | No (needs Node.js runtime) | No (needs Python runtime) | **Yes** — static binary, cross-platform |
| **CLI embedding** | Cannot embed in Go CLI | Cannot embed in Go CLI | **Direct Go import** |
| **gRPC stub reuse** | Needs separate TS stubs | Needs separate Python stubs | **Direct import** from `apis/stubs/go/` |
| **Stigmer backend match** | No (backend is Go) | Partial (agent-runner is Python) | **Yes** (stigmer-server, workflow-runner, CLI) |
| **Build toolchain** | npm/yarn (different from repo) | pip/poetry (different) | **Same** Go toolchain as rest of repo |

### Industry data

- **GitHub's MCP Server** (27K stars, the most prominent MCP server) — **Go** (95.7%)
- **Planton's MCP Server** (our own reference) — **Go**
- TypeScript dominates in count of community servers (Notion, Repomix, etc.), largely because of NPX convenience
- Python is popular for AI/data use cases
- **For infrastructure and platform tools, Go is the industry standard** — the pattern GitHub, Planton, and other platform MCP servers follow

### The NPX trade-off

TypeScript's main advantage is `npx` — zero-install distribution for anyone with Node.js. But:

1. It's a **distribution convenience**, not a technical advantage
2. The same convenience exists for Go via `go install ...@latest` (for Go users) and `docker run` (for everyone)
3. Choosing TypeScript for NPX would mean: introducing Node.js into an all-Go project, regenerating TypeScript gRPC stubs, separate build toolchain, inability to embed in CLI — a heavy cost for a distribution nice-to-have
4. If NPX demand materializes, we can publish a thin npm wrapper that downloads the Go binary (Phase 3)

### Decision

**Go**, using the **official Anthropic Go SDK** (`github.com/modelcontextprotocol/go-sdk`).

This is a notable improvement over Planton, which uses the older community SDK (`mark3labs/mcp-go` v0.6.0). The official SDK:
- Is maintained by Anthropic in collaboration with Google
- Has full MCP spec compliance (latest: 2025-06-18, supports back to 2024-11-05)
- Provides typed tool handlers with Go struct input/output (better DX than raw `map[string]any`)
- Includes built-in `auth` and `oauthex` packages (less custom auth code needed)
- Supports `StdioTransport` and `StreamableHTTPHandler` natively
- Is what the ecosystem is converging on (acknowledged by `mcp-go` authors themselves)

> **Note for Planton**: The Planton MCP server should consider migrating from `mark3labs/mcp-go` to `modelcontextprotocol/go-sdk` in a future update.

---

## Decision 3: Transport Strategy — STDIO + HTTP (Both)

We support **both** transports from day one. There's nothing stopping us — the official Go SDK supports both out of the box.

### Transport Modes

| Mode | Config Value | Description |
|---|---|---|
| **stdio** | `STIGMER_MCP_TRANSPORT=stdio` | MCP server runs as subprocess of AI tool, communicates via stdin/stdout. Default. |
| **http** | `STIGMER_MCP_TRANSPORT=http` | MCP server runs as HTTP service with Streamable HTTP. For remote/shared access. |
| **both** | `STIGMER_MCP_TRANSPORT=both` | Dual transport — stdio + HTTP simultaneously. |

### STDIO Transport
- Primary mode for local development (Cursor, Claude Desktop)
- AI tool spawns the MCP server binary as a child process
- API key passed via `STIGMER_API_KEY` environment variable
- Zero network config — just works
- Uses `mcp.StdioTransport{}` from the official SDK
- Example Cursor config:
  ```json
  {
    "mcpServers": {
      "stigmer": {
        "command": "mcp-server-stigmer",
        "env": {
          "STIGMER_API_KEY": "your-api-key",
          "STIGMER_SERVER_ADDRESS": "localhost:9090"
        }
      }
    }
  }
  ```

### HTTP Transport (Streamable HTTP)
- For shared/remote deployments and multi-user scenarios
- Bearer token authentication per request (each user's identity preserved)
- Health check endpoint at `/health`
- Uses `mcp.StreamableHTTPHandler` from the official SDK (improvement over Planton's SSE-only approach)
- Supports both SSE streaming and Streamable HTTP (the newer MCP transport spec)
- Example Cursor config:
  ```json
  {
    "mcpServers": {
      "stigmer": {
        "type": "http",
        "url": "http://localhost:8080/",
        "headers": {
          "Authorization": "Bearer YOUR_STIGMER_API_KEY"
        }
      }
    }
  }
  ```

### Why both from day one?
- The official SDK provides `mcp.StdioTransport{}` and `mcp.StreamableHTTPHandler` — minimal code
- HTTP mode enables Docker-based deployment and shared team servers immediately
- Planton already proved this works; we just use a better SDK

### Improvement over Planton's transport

Planton uses `mcp-go`'s `SSEServer` with a custom proxy to rewrite internal URLs. The official SDK's `StreamableHTTPHandler` is cleaner:
- No internal proxy needed
- Native Streamable HTTP support (the newer spec, not just legacy SSE)
- Built-in connection lifecycle management (`OnConnectionClose` callbacks)
- Simpler auth middleware integration

---

## Decision 4: Authentication & Identity Model

Every MCP tool call must carry the user's identity so that gRPC calls to stigmer-server respect permissions.

### Authentication Flow

**STDIO mode:**
```
User's API key → STIGMER_API_KEY env var → MCP server reads at startup → attaches to every gRPC call
```

**HTTP mode:**
```
User's API key → Authorization: Bearer header → MCP server extracts per-request → attaches to gRPC call
```

### Implementation

We follow the Planton auth pattern but with improvements from the official SDK:

1. **gRPC `PerRPCCredentials`** — `tokenAuth` struct that attaches `Authorization: Bearer <token>` to every gRPC call. Same proven pattern from Planton.

2. **Context-based API key propagation:**
   - `WithAPIKey(ctx, key)` — stores API key in context
   - `GetAPIKey(ctx)` — retrieves API key from context
   - HTTP middleware extracts Bearer token and injects into context

3. **Improvement over Planton's workaround:**
   Planton uses a `globalAPIKeyStore` (mutex-protected global variable) because `mcp-go`'s `AddTool` doesn't pass context to tool handlers. The official Go SDK's typed tool handlers receive `context.Context` as the first parameter:
   ```go
   func ListAgents(ctx context.Context, req *mcp.CallToolRequest, input ListAgentsInput) (
       *mcp.CallToolResult, ListAgentsOutput, error,
   ) {
       // ctx carries the user's API key — no global store needed!
       apiKey, _ := auth.GetAPIKey(ctx)
       // ... use apiKey for gRPC call
   }
   ```
   This eliminates the race condition risk in Planton's approach and properly supports concurrent multi-user HTTP scenarios.

### Stigmer-Specific Considerations

**Local mode** (stigmer-server running locally via CLI):
- Authentication may be optional or use a local token
- The MCP server connects to `localhost:PORT` — no TLS needed
- Could auto-discover server address from Stigmer CLI config

**Cloud mode** (future — connecting to remote Stigmer Cloud):
- Full API key authentication required
- TLS connection to remote endpoint
- Official SDK's `auth` and `oauthex` packages may be useful here

---

## Decision 5: MCP Primitives Mapping

### Tools (Phase 1 — Read-only)

| Tool Name | Description | gRPC Call |
|---|---|---|
| `list_agents` | List all agents | `AgentQueryController.Get` |
| `get_agent` | Get agent by org/slug | `AgentQueryController.GetByReference` |
| `list_skills` | List all skills | `SkillQueryController.Get` |
| `get_skill` | Get skill by org/slug | `SkillQueryController.GetByReference` |
| `list_workflows` | List all workflows | `WorkflowQueryController.Get` |
| `get_workflow` | Get workflow by org/slug | `WorkflowQueryController.GetByReference` |

With the official SDK, each tool gets typed input/output structs:
```go
type GetAgentInput struct {
    Org  string `json:"org"  jsonschema:"the organization that owns the agent"`
    Slug string `json:"slug" jsonschema:"the agent's slug identifier"`
}

type GetAgentOutput struct {
    Agent AgentSummary `json:"agent"`
}
```

### Tools (Phase 2 — Write Operations)

| Tool Name | Description | gRPC Call |
|---|---|---|
| `apply_agent` | Create or update agent | `AgentCommandController.Apply` |
| `apply_workflow` | Create or update workflow | `WorkflowCommandController.Apply` |
| `push_skill` | Push skill artifact | `SkillCommandController.Push` |
| `delete_agent` | Delete agent | `AgentCommandController.Delete` |
| `delete_workflow` | Delete workflow | `WorkflowCommandController.Delete` |
| `delete_skill` | Delete skill | `SkillCommandController.Delete` |

### Tools (Phase 3 — Execution & Management)

| Tool Name | Description |
|---|---|
| `list_mcp_servers` | List registered MCP servers |
| `get_mcp_server` | Get MCP server details |
| `run_agent` | Trigger agent execution |
| `run_workflow` | Trigger workflow execution |
| `get_execution_status` | Check execution status |
| `list_projects` | List projects |
| `get_project` | Get project details |

### Resources (MCP Resources — Phase 1)

MCP Resources provide URI-addressable read-only data. We expose these alongside Tools:

| URI Pattern | Description |
|---|---|
| `stigmer://agents` | List of all agents |
| `stigmer://agents/{org}/{slug}` | Individual agent definition |
| `stigmer://skills` | List of all skills |
| `stigmer://skills/{org}/{slug}` | Individual skill definition |
| `stigmer://workflows` | List of all workflows |
| `stigmer://workflows/{org}/{slug}` | Individual workflow definition |

### Prompts (Future)

| Prompt Name | Description |
|---|---|
| `create_agent` | Guided agent authoring prompt |
| `create_workflow` | Guided workflow authoring prompt |
| `debug_execution` | Debugging failed executions |

---

## Decision 6: Distribution Strategy

### What is NPX and can we do it?

**NPX** (Node Package Execute) is a Node.js tool that lets you run npm packages directly without installing them. Many popular TypeScript/JavaScript MCP servers use this pattern:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }
    }
  }
}
```

This works because those MCP servers are TypeScript and published to npm. The `npx -y` command downloads and runs them instantly — zero install, always latest version.

**Can we do this for Stigmer?** Not directly with `npx` since we're writing in Go. But we have equivalent and even better alternatives:

### Distribution Options for Go MCP Server

| Method | Command | Zero Install? | Auto-Update? |
|---|---|---|---|
| **Docker** (recommended for HTTP) | `docker run ghcr.io/stigmer/mcp-server-stigmer` | Yes (if Docker) | Yes (`:latest`) |
| **Go install** | `go install github.com/stigmer/stigmer/mcp-server@latest` | Yes (if Go) | Manual |
| **Binary releases** (GitHub) | `curl -L .../mcp-server-stigmer.tar.gz \| tar xz` | No | Manual |
| **Homebrew** | `brew install stigmer/tap/mcp-server-stigmer` | Yes (if Homebrew) | `brew upgrade` |
| **Stigmer CLI embedded** (future) | `stigmer mcp-server start` | Yes (if CLI) | With CLI updates |
| **NPX wrapper** (optional) | `npx @stigmer/mcp-server` | Yes (if Node) | Yes |

GitHub's MCP server (the most popular, also Go) distributes via binary releases and Docker — no NPX. Same proven model.

### Recommended Distribution Strategy

1. **Phase 1**: Binary in the mono repo build + Docker image
2. **Phase 2**: Homebrew tap + `stigmer mcp-server` CLI subcommand
3. **Phase 3 (optional)**: NPX wrapper if there's demand from JS ecosystem users

---

## Architecture Overview

```
┌────────────────────┐
│   MCP Clients      │
│ (Cursor, Claude,   │
│  Windsurf, etc.)   │
└────────┬───────────┘
         │
         │  stdio (subprocess)  OR  Streamable HTTP (network)
         │
┌────────▼───────────────────────────────────────────────┐
│  mcp-server-stigmer                                     │
│                                                         │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────┐ │
│  │ Transport    │  │ Domain Handlers  │  │ Auth      │ │
│  │ StdioTransp  │  │ (agents, skills, │  │ (API key  │ │
│  │ Streamable   │  │  workflows)      │  │  → gRPC   │ │
│  │ HTTPHandler  │  │                  │  │ PerRPC    │ │
│  └──────┬───────┘  └────────┬─────────┘  │ Creds)    │ │
│         │                   │            └─────┬─────┘ │
│         │  Official Go SDK  │                  │       │
│         │  (modelcontext    │                  │       │
│         │   protocol/go-sdk)│                  │       │
│         └───────────────────┼──────────────────┘       │
│                             │                           │
└─────────────────────────────┼───────────────────────────┘
                              │  gRPC (with per-user credentials)
                              │
                    ┌─────────▼──────────┐
                    │  stigmer-server    │
                    │  (gRPC API)        │
                    │  localhost or      │
                    │  remote endpoint   │
                    └────────────────────┘
```

### Code Structure

```
mcp-server/
├── cmd/
│   └── mcp-server-stigmer/
│       └── main.go                    # Entry point (stdio/http/both switch)
├── internal/
│   ├── server/
│   │   ├── server.go                  # MCP server init + tool/resource registration
│   │   └── http.go                    # HTTP transport with auth middleware
│   ├── config/
│   │   └── config.go                  # Environment-based config
│   ├── auth/
│   │   └── credentials.go            # API key → gRPC PerRPCCredentials + context
│   ├── grpc/
│   │   └── client.go                 # gRPC client factory for stigmer-server
│   └── domains/
│       ├── agents/
│       │   └── tools.go               # list_agents, get_agent (typed handlers)
│       ├── skills/
│       │   └── tools.go               # list_skills, get_skill (typed handlers)
│       └── workflows/
│           └── tools.go               # list_workflows, get_workflow (typed handlers)
├── go.mod
├── go.sum
├── Dockerfile
└── README.md
```

Key structural differences from Planton:
- `internal/server/` instead of `internal/mcp/` — clearer naming
- `internal/grpc/` — dedicated gRPC client layer (Planton creates clients inline in each domain)
- No `http_server.go` with custom proxy — official SDK's `StreamableHTTPHandler` handles this
- Typed tool handlers with input/output structs (official SDK feature)

---

## Configuration (Environment Variables)

| Variable | Default | Required | Description |
|---|---|---|---|
| `STIGMER_SERVER_ADDRESS` | `localhost:9090` | No | gRPC address of stigmer-server |
| `STIGMER_API_KEY` | — | Yes (stdio) | API key for authentication |
| `STIGMER_MCP_TRANSPORT` | `stdio` | No | Transport: `stdio`, `http`, `both` |
| `STIGMER_MCP_HTTP_PORT` | `8080` | No | HTTP server port |
| `STIGMER_MCP_HTTP_AUTH_ENABLED` | `true` | No | Bearer token auth for HTTP |

---

## Implementation Plan

### Step 1: Project Scaffolding
- Create `mcp-server/` directory with Go module
- Add dependencies: `github.com/modelcontextprotocol/go-sdk`, Stigmer gRPC stubs, `google.golang.org/grpc`
- Set up `cmd/mcp-server-stigmer/main.go` with transport switch
- Set up `internal/config/config.go` (adapt from Planton)

### Step 2: Auth & gRPC Client
- Implement `internal/auth/credentials.go` — `PerRPCCredentials` adapter + context helpers
- Implement `internal/grpc/client.go` — factory for creating authenticated gRPC connections
- Support both local (insecure) and remote (TLS) connections

### Step 3: Transport Layer
- Implement `internal/server/server.go`:
  - Create `mcp.NewServer(&mcp.Implementation{Name: "stigmer", Version: "..."}, nil)`
  - Register tools using `mcp.AddTool(server, tool, handler)` with typed handlers
  - `server.Run(ctx, &mcp.StdioTransport{})` for stdio mode
- Implement `internal/server/http.go`:
  - Auth middleware that extracts Bearer token and injects into context
  - `mcp.StreamableHTTPHandler` for HTTP mode
  - Health check endpoint
- Support `both` mode (goroutine for each transport)

### Step 4: Domain Handlers (Phase 1 Resources)
- `internal/domains/agents/tools.go` — `list_agents`, `get_agent` with typed input/output
- `internal/domains/skills/tools.go` — `list_skills`, `get_skill` with typed input/output
- `internal/domains/workflows/tools.go` — `list_workflows`, `get_workflow` with typed input/output
- Each tool: typed input struct → gRPC call with auth context → typed output struct

### Step 5: MCP Resource Handlers
- Register URI-based resources for agents, skills, workflows
- Enable resource capabilities on the MCP server

### Step 6: Testing & Documentation
- Integration tests against a running stigmer-server
- MCP client compatibility testing (Cursor, Claude Desktop)
- README with setup instructions (Cursor, Claude Desktop, Docker)
- Dockerfile for containerized deployment

---

## Comparison: Official SDK vs Planton's Approach

| Aspect | Planton (`mark3labs/mcp-go`) | Stigmer (Official `go-sdk`) | Improvement |
|---|---|---|---|
| **SDK** | Community `mcp-go` v0.6.0 | Official `modelcontextprotocol/go-sdk` v1.2+ | Official support, Anthropic + Google maintained |
| **Tool handlers** | `func(ctx, req) (*mcp.CallToolResult, error)` with raw `map[string]any` args | Typed: `func(ctx, req, Input) (*Result, Output, error)` with Go structs | Type safety, auto-generated JSON schema from struct tags |
| **HTTP transport** | Custom SSE proxy with internal port rewriting | Native `StreamableHTTPHandler` | No proxy hack, supports Streamable HTTP spec |
| **Auth in tools** | Global `apiKeyStore` mutex workaround | Context-based — tool handlers receive `ctx` with API key | Thread-safe, proper multi-user concurrency |
| **OAuth support** | None | Built-in `auth` and `oauthex` packages | Ready for cloud mode |
| **Spec compliance** | Partial (community maintained) | Full (official, tested against spec conformance suite) | Future-proof |

---

## What We're Covering vs. Planton Reference

| Capability | Planton MCP Server | Stigmer MCP Server (Plan) | Notes |
|---|---|---|---|
| **Language** | Go + mcp-go | Go + **official go-sdk** | Upgraded SDK |
| **STDIO transport** | Yes | Yes | Phase 1 |
| **HTTP transport** | SSE only | **Streamable HTTP** (newer spec) | Improved |
| **Dual transport (both)** | Yes | Yes | Phase 1 |
| **Per-user API key auth** | Yes (Bearer token) | Yes (same pattern, better impl) | Phase 1 |
| **gRPC PerRPCCredentials** | Yes | Yes | Same auth adapter |
| **Auth in tool handlers** | Global store (race risk) | **Context-based** (thread-safe) | Improved |
| **Domain-based tool org** | Yes (5 domains) | Yes (3 domains initially) | agents, skills, workflows |
| **Typed tool handlers** | No (raw maps) | **Yes** (Go structs) | Official SDK feature |
| **Health check endpoint** | Yes (`/health`) | Yes | Phase 1 |
| **Docker deployment** | Yes (ghcr.io) | Yes | Phase 1 |
| **OAuth support** | No | Built-in (future cloud mode) | Official SDK feature |
| **MCP Resources** | Yes (capabilities enabled) | Yes | Phase 1 |
| **Write/mutation tools** | Yes (CRUD) | Phase 2 | Start read-only |
| **NPX distribution** | No | Optional (Phase 3) | Go binary wrapper |

---

## Success Criteria for T01

- [ ] Repository placement decision confirmed (mono repo recommended)
- [ ] Go + official `modelcontextprotocol/go-sdk` confirmed as the stack
- [ ] Transport strategy confirmed (stdio + Streamable HTTP from day one)
- [ ] Authentication model confirmed (per-user API keys, context-based, PerRPCCredentials)
- [ ] Phase 1 scope confirmed (agents, skills, workflows — list + get)
- [ ] Distribution strategy confirmed (binary + Docker first)
- [ ] Code structure approved
- [ ] Ready to begin T02 (Scaffolding & Core Implementation)

---

## Next Task Preview

**T02: Scaffolding & Core Implementation** — Set up the Go project with the official SDK, implement auth + gRPC client, transport layer (stdio + HTTP), and deliver the first 6 tools (list/get for agents, skills, workflows).

---

## Review Process

**What happens next:**
1. **You review this plan** — Consider the decisions and scope
2. **Provide feedback** — Share your thoughts on any decisions
3. **I'll revise the plan** — Create `T01_2_revised_plan.md` incorporating feedback
4. **You approve** — Give explicit approval to proceed
5. **Execution begins** — Implementation tracked in subsequent tasks

**Key questions for your review:**
- Mono repo vs standalone — aligned?
- Official Go SDK over Planton's mcp-go — good?
- STDIO + Streamable HTTP from day one — good?
- Auth model (context-based, improvement over Planton's global store) — good?
- Phase 1 scope (read-only: agents, skills, workflows) — right?
- Where in the mono repo? (`mcp-server/` at root?)
- Distribution priority (binary + Docker first, Homebrew + NPX later)?
