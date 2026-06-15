---
name: mcp-server-creator
visibility: public
description: >
  Create valid, production-quality Stigmer McpServer YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill when users want to: (1) create a new
  McpServer resource for connecting agents to external tools (GitHub, Slack, databases,
  custom APIs), (2) configure MCP server transport (stdio subprocess or HTTP endpoint),
  (3) declare environment variable requirements and credential contracts, (4) set default
  tool gates and approval policies for human-in-the-loop safety, (5) understand how agents
  reference McpServers via mcp_server_usages. Triggers on requests mentioning MCP server,
  McpServer, tool integration, or connecting an agent to an external service.
---

# MCP Server Creator

Create valid `agentic.stigmer.ai/v1` McpServer YAML resources. Follow the six-step
workflow below in order for every McpServer creation request.

## Step 1 — Understand the MCP Server

Before writing any YAML, gather these details from the user:

1. **External system** — What does the MCP server connect to? (GitHub, Slack, a database, a custom API, etc.)
2. **Server type** — Is it a CLI tool started as a subprocess (`stdio`) or a remote HTTP service (`http`)?
   - If the user mentions `npx`, `python -m`, `uvx`, a Go binary, or any CLI command → `stdio`
   - If the user mentions a URL, hosted service, or API gateway → `http`
   - When in doubt, default to `stdio` — the vast majority of MCP servers use it
3. **Credentials** — What environment variables does the server need? Which are secrets?
4. **Tools** — What tools should be enabled by default? Which tools are destructive and need approval?
5. **Ownership** — What organization owns this server? Should it be public (marketplace) or private?

If the user has already provided sufficient context, proceed directly. Do not ask questions
the user has already answered.

## Step 2 — Choose the Server Type

Exactly one of `stdio` or `http` must be specified. This is a proto `oneof` with `required` validation — omitting both or specifying both fails.

**Use `stdio`** (most common) for subprocess-based servers:
```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

**Use `http`** for remote/managed services:
```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"
    headers:
      Authorization: "Bearer ${API_TOKEN}"
    timeout_seconds: 45
```

For field details, see [references/schema.md](references/schema.md).

## Step 3 — Configure Environment Variables

Declare every environment variable in `env`. For each variable:
- Set `is_secret: true` for API tokens, passwords, private keys
- Set `is_secret: false` for regions, org names, URLs, feature flags
- Set `optional: true` for variables with sensible defaults or that enable non-critical features
- Write a `description` that specifies required permissions/format
- **Never pre-fill secret values** — values are provided at runtime via AgentInstance

```yaml
spec:
  env:
    GITHUB_TOKEN:
      description: "GitHub personal access token with repo and read:org scopes"
      is_secret: true
    GITHUB_OWNER:
      description: "Default GitHub organization or username"
      is_secret: false
    LOG_LEVEL:
      description: "Server log level (default: ERROR)"
      is_secret: false
      optional: true
```

For HTTP servers, ensure every `${VAR_NAME}` in headers/query_params has a matching `env` entry.

## Step 4 — Set Default Tools and Approval Policies

### Default Enabled Tools
Use `default_enabled_tools` to gate which tools are available by default. Empty = all tools enabled. Agents can only restrict further, never expand beyond this list.

### Default Tool Approvals
Use `default_tool_approvals` for destructive or sensitive operations. Each entry needs:
- `tool_name` — exact name from the server's `tools/list` (case-sensitive)
- `message` — approval prompt with `{{args.field}}` placeholders for context

**Tool names must be verified, not guessed.** If the user doesn't know exact tool names, recommend running `stigmer discover mcp-server <slug>` after applying, then updating the YAML with discovered names.

For the approval policy chain and message template syntax, see [references/agent-integration.md](references/agent-integration.md).

## Step 5 — Validate the YAML

Before presenting the final YAML, verify every rule in [references/validation.md](references/validation.md). Critical checks:

1. `apiVersion` is exactly `agentic.stigmer.ai/v1`
2. `kind` is exactly `McpServer` (PascalCase)
3. `metadata.name` is present
4. Exactly one of `spec.stdio` or `spec.http` is specified
5. `spec.stdio.command` is present (for stdio servers)
6. `spec.http.url` is a valid HTTP/HTTPS URL (for http servers)
7. No `status` fields are set (system-managed)
8. No secret values pre-filled in `env`
9. Slug format: `^[a-z][a-z0-9-]*$`, 1–63 chars (if specified)
10. `${VAR_NAME}` syntax in HTTP headers/params (not `{{}}`)
11. `{{args.field}}` syntax in approval messages (not `${}`)

## Step 6 — Explain Agent Integration

After delivering the McpServer YAML, explain how agents reference it:

```yaml
# In an Agent spec
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: <mcpserver-slug>    # matches the McpServer's metadata.slug
      enabled_tools:              # optional — subset of default_enabled_tools
        - tool_one
        - tool_two
      tool_approval_overrides:    # optional — per-agent customization
        - tool_name: dangerous_tool
          requires_approval: true
          message: "Custom approval message"
```

Key points to convey:
- The McpServer contains no secrets — credentials come from AgentInstance's environment binding
- Agents reference by `org/slug` — slug is auto-generated from `metadata.name` if not set
- The three-layer approval chain: McpServer defaults → Agent overrides → Execution bypass
- After applying, run `stigmer discover mcp-server <slug>` to populate tool metadata
- In references, use `kind: mcp_server` (snake_case), not `kind: McpServer` (PascalCase)

For complete agent integration details, see [references/agent-integration.md](references/agent-integration.md).

## Reference Files

| File | When to Read |
|------|-------------|
| [references/schema.md](references/schema.md) | Need field-level details for any McpServer spec field |
| [references/examples.md](references/examples.md) | Need complete YAML examples (minimal → marketplace-ready) |
| [references/validation.md](references/validation.md) | Need the full validation checklist before presenting YAML |
| [references/agent-integration.md](references/agent-integration.md) | Need to explain how agents reference McpServers, tool approval chain, or sub-agent access |
