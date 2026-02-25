---
name: MCP Server README Overhaul
overview: Completely rewrite `mcp-server/README.md` to be architecturally accurate, contractually complete, and contributor-ready. Fix one confirmed code bug (wrong default port in `internal/config/config.go`). No code changes beyond that single constant.
todos:
  - id: fix-port-default
    content: Fix STIGMER_SERVER_ADDRESS default in mcp-server/internal/config/config.go from localhost:9090 to localhost:7234
    status: completed
  - id: rewrite-readme
    content: "Rewrite mcp-server/README.md with all 10 sections: Overview+diagram, Glossary, Installation (with Docker networking fix), Client Config (with VS Code servers key example), Config Reference (fixed port + TLS note), Tools Reference (full per-tool docs + skill asymmetry callout), Resources Reference (stigmer:// scheme + resource_uri explanation), HTTP Mode (expanded), Development (make targets + codegen pipeline), License (Apache 2.0)"
    status: completed
  - id: verify-lints
    content: Run ReadLints on config.go to confirm the port change introduces no regressions
    status: completed
isProject: false
---

# MCP Server README Overhaul

## Target file

`[mcp-server/README.md](mcp-server/README.md)`

## Code bug to fix simultaneously

`[mcp-server/internal/config/config.go](mcp-server/internal/config/config.go)` line 36:

- `envOr("STIGMER_SERVER_ADDRESS", "localhost:9090")` → `"localhost:7234"`
- Reason: stigmer-server's actual default gRPC port is `7234` (confirmed in `backend/services/stigmer-server/pkg/config/config.go`). The existing README examples already use `7234`; the env vars table and the code default are the bugs.

---

## README Sections (in order)

### 1. Overview (new)

One tight paragraph: what this server is (a **stateless MCP-to-gRPC gateway**), what it enables (AI IDEs discover, inspect, and manage Stigmer resources via MCP), and what it is not (not a Stigmer server itself — it requires a running `stigmer-server`).

Architecture diagram:

```
AI IDE (Cursor / Claude / VS Code)
        ↕ MCP protocol (stdio or HTTP)
  mcp-server-stigmer       ← this repo
        ↕ gRPC (TLS on :443, plaintext otherwise)
     stigmer-server
```

### 2. Key Concepts / Glossary (new)

Define every term used throughout the README, grounded in the actual domain:

- **org** — organization slug; tenant-level namespace (e.g. `acme`)
- **slug** — URL-safe unique identifier within an org (e.g. `code-reviewer`)
- **agent** — an AI agent definition (model, instructions, skills, MCP servers)
- **skill** — versioned knowledge artifact; read-only via MCP (see Tool Reference for why)
- **workflow** — orchestration definition (tasks, branching, env)
- **MCP server** — a registered external tool server that agents can connect to
- **apply** — idempotent create-or-update (same semantics as `kubectl apply`)
- `**stigmer://` URI** — `stigmer://{kind-plural}/{org}/{slug}[/{version}]`; used by `search` results and `resources/read`

### 3. Installation (keep, minor fix)

Keep all four methods. Fix the Docker networking note: add a callout that `localhost` inside a container refers to the container itself; use `host.docker.internal` on Docker Desktop (Mac/Windows) or `--network host` on Linux when connecting to a host-side stigmer-server.

### 4. MCP Client Configuration (keep + add VS Code example)

Keep all three JSON config blocks. Add a VS Code–specific example showing `"servers"` (not `"mcpServers"`) as the top-level key — this is currently only in the table, which many readers skip. The Docker example's `STIGMER_SERVER_ADDRESS: localhost:7234` is correct; keep it.

### 5. Configuration Reference (update default + add TLS note)

Fix the env vars table: `STIGMER_SERVER_ADDRESS` default → `localhost:7234`.
Add a TLS note under the table: connections to `:443` use system root CAs automatically; all other ports use plaintext. No `STIGMER_TLS` flag is needed.

### 6. Tools Reference (major expansion)

Replace the one-liner table with a per-tool reference block. Each entry covers:

- **Purpose** (one sentence)
- **Required / optional parameters** (pulled directly from the `*Input` struct tags in source)
- **Example call** (JSON)
- **Example response format** (e.g., "Returns the agent definition as JSON")
- **Error cases** (not-found, permission-denied, etc.)

Key decisions grounded in the code:

`**search`** — document all 6 parameters from `SearchInput` (`kinds`, `query`, `org`, `exclude_public`, `page_size`, `page_num`). Document the three usage modes from the package comment: list, search, filtered-search. Explain `resource_uri` injection per result.

`**get_skill`** — document that `version` accepts a tag name (e.g. `stable`, `v1.0`) or a SHA-256 content hash. Omit for latest.

**Skill asymmetry — explicit callout (critical)**: Skills have no `apply_skill` tool. This is intentional: skill content is structured as a versioned knowledge artifact managed by the `stigmer skill push` CLI command. The MCP server exposes skills as read-only resources to AI IDEs. Document this explicitly so consumers do not assume a documentation bug.

### 7. Resources Reference (expand)

Explain the `stigmer://` URI scheme in full: structure, the kind-to-path-segment mapping (`agent→agents`, `mcp_server→mcp-servers`, `skill→skills`, `workflow→workflows`), how to use `resources/read` directly if you already have a URI, and the MIME type (`application/json`).

Explain the `resource_uri` field in `search` results: it is injected server-side by `enrichSearchResponse()` for all four supported kinds. Consumers can pass it directly to `resources/read` without constructing the URI themselves.

### 8. HTTP Mode (expand)

- Clarify transport: MCP Streamable HTTP (not REST)
- Clarify the Bearer token: it is the same `STIGMER_API_KEY` value; each HTTP request must carry it
- Add `STIGMER_MCP_HTTP_AUTH_ENABLED=false` use-case and warning (internal/trusted networks only)
- Mention the `both` transport mode and its use-case (dev environments wanting local + remote access simultaneously)
- Note that HTTP mode does not yet support TLS termination natively; put a TLS-terminating reverse proxy in front for production

### 9. Development (new section for contributors)

- `make build` / `make test` / `make lint` / `make fmt`
- Code generation pipeline: proto → JSON schema (`make codegen-schemas`) → MCP input types (`make codegen-mcp`). The `gen/` directory is auto-generated; never edit by hand.
- Domain package pattern: every domain (`agents`, `skills`, `workflows`, `mcpservers`) follows `tools.go` / `resources.go` / `fetch.go` / `apply.go` / `delete.go`. Adding a new domain means following this pattern and registering in `internal/server/server.go`.
- Note on `gen/` and `go vet`: generated code is excluded from `go vet` because the `jsonschema-go` tag convention triggers a false positive in the struct-tag checker.

### 10. License (fix)

Replace the vague reference with: "Apache License 2.0. See [LICENSE](../LICENSE)."

---

## What this plan does NOT do

- Does not change any tool behaviour
- Does not add `apply_skill` (intentional absence, documented in the README)
- Does not restructure the domain packages
- Does not change any transport logic
- Code changes are limited to the single port default fix in `config.go`

---

## Execution order

1. Fix `config.go` default port (`localhost:7234`)
2. Rewrite `README.md` in full (one atomic edit, all sections)
3. Read lints on `config.go` to confirm no regressions

