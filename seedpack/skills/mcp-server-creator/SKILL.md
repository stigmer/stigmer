---
name: mcp-server-creator
description: >
  Create and validate Stigmer McpServer YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill when a user wants to define an MCP
  server integration — connecting an AI agent to GitHub, Slack, a database, a
  web-search service, or any other external system that speaks the Model Context
  Protocol. Triggers on requests like: "create an MCP server for GitHub",
  "write a McpServer YAML for my Postgres database", "help me configure an MCP
  server with tool approvals", "publish an MCP server to the marketplace", or
  "add an MCP server to my agent".
---

# MCP Server Creator

Produce valid, production-quality `agentic.stigmer.ai/v1` McpServer YAML files.

## Reference Files

Load these as needed — do not pre-load all of them:

- **`references/schema.md`** — Complete field reference (metadata, spec, env_spec, tool gates, approvals, status). Read when you need field-level details or validation rules.
- **`references/examples.md`** — Eight ready-to-apply YAML examples covering minimal stdio, stdio with credentials, tool gates, approval policies, HTTP servers, and marketplace publishing. Read when working on a specific pattern.
- **`references/agent-integration.md`** — How agents reference McpServers via `mcp_server_usages`, tool availability chain, approval overrides, sub-agent access, and runtime flow. Read when explaining how an agent consumes the McpServer.

## Six-Step Workflow

### Step 1 — Understand the intent

Before writing any YAML, ask (or infer) these four questions. Most answers come from context; ask only what is missing:

1. **What external system?** (GitHub, Slack, a database, a web API, etc.)
2. **How is it started?** stdio (subprocess — npx, python, go binary) or http (remote/managed service)?
   - Default to `stdio`. Use `http` only for already-running remote services.
3. **What credentials does it need?** List all required tokens, connection strings, and IDs. Classify each as secret or non-secret.
4. **What tools should be available/protected?** Which tools should be gated by default? Which require human approval?

Do not write YAML until you have answers to 1 and 2.

### Step 2 — Choose the server type

**Use `stdio` when:**
- The MCP server is an npm package (`npx @modelcontextprotocol/server-*`)
- The MCP server is a Python module (`python -m mcp_server_*`)
- The MCP server is a local binary

**Use `http` when:**
- The service is already running remotely (hosted/managed MCP endpoint)
- Multiple concurrent agents share a single server instance
- The server is behind an API gateway or reverse proxy

Exactly one must be present — the proto enforces `oneof server_type required`.

### Step 3 — Draft the YAML

Start from the correct skeleton:

**stdio skeleton:**
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: <name>
  org: <org>
spec:
  description: "<what it does and primary use cases>"
  stdio:
    command: <npx|python|node|binary>
    args: [...]
  env_spec:
    data:
      <VAR_NAME>:
        description: "<format and required permissions>"
        is_secret: <true|false>
  default_enabled_tools:
    - <tool-name>   # leave empty list if all tools should be available
  default_tool_approvals:
    - tool_name: <tool-name>
      message: "<Action verb + {{args.field}} context>"
```

**http skeleton:**
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: <name>
  org: <org>
spec:
  description: "<what it does>"
  http:
    url: "https://<endpoint>"
    headers:
      Authorization: "Bearer ${<TOKEN_VAR>}"
    timeout_seconds: 30
  env_spec:
    data:
      <TOKEN_VAR>:
        description: "<format and permissions>"
        is_secret: true
```

**Filling in fields:**
- `metadata.name`: Human-readable, becomes the slug source. Use a short, clear name.
- `metadata.org`: Set to the user's org. Use `default` for local mode.
- `spec.description`: One sentence describing purpose and use cases. This appears in the marketplace.
- `env_spec.data` keys: Use the EXACT environment variable names the MCP server expects (they are fixed by the server implementation, not chosen freely).
- `env_spec.data[*].is_secret`: `true` for API keys, tokens, passwords, connection strings. `false` for regions, org IDs, non-sensitive config.
- `env_spec.data[*].value`: **Always leave empty.** Values come from AgentInstance at runtime.
- `default_enabled_tools`: If the user can enumerate the tools they want, list them. If the server's full tool list should be available, omit this field.
- `default_tool_approvals`: Require for any tool that is destructive (delete, drop, force push, send external messages).

### Step 4 — Configure tool names carefully

Tool names are the most error-prone part of McpServer YAML. Follow this rule:

> **Never guess tool names. Always verify.**

The correct workflow after first apply:
```bash
stigmer mcp-server apply mcpserver.yaml
stigmer discover mcp-server <slug>
stigmer mcp-server get <slug> --output yaml
# Copy names from status.discovered_capabilities.tools[*].name
```

When you cannot run discovery (new server, user working offline):
- Omit `default_enabled_tools` (leave empty = all tools enabled). The user runs discovery and adds the list.
- Write `default_tool_approvals` with your best knowledge of the tool names, and annotate them with a comment to verify after discovery.
- State clearly in your response that these names should be verified after running `stigmer discover mcp-server <slug>`.

**Silent-failure rule:** A typo in `tool_name` (in either `default_enabled_tools` or `default_tool_approvals`) is silently ignored — no error, no warning, no approval applied. This is the #1 production pitfall.

### Step 5 — Validate before presenting

Run through this checklist before showing the final YAML:

**Structure**
- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `McpServer` (PascalCase; `mcpserver`, `Mcpserver`, `mcp_server` are wrong)
- [ ] Exactly one of `spec.stdio` or `spec.http` is present
- [ ] No `status` fields in the YAML (system-managed only)

**Fields**
- [ ] `spec.stdio.command` is present when `stdio` is used
- [ ] `spec.http.url` is a valid HTTP/HTTPS URL when `http` is used
- [ ] `http.timeout_seconds` is 0–300 if set
- [ ] All `${VAR_NAME}` placeholders in `http.headers`/`query_params` have a matching `env_spec.data` entry
- [ ] `env_spec.data[*].value` is empty for secrets (never pre-fill)
- [ ] Approval `message` uses `{{args.field}}` syntax (not `${args.field}`)
- [ ] HTTP `headers` use `${VAR_NAME}` syntax (not `{{VAR_NAME}}`)

**Slug / metadata**
- [ ] `metadata.slug` (if set) matches `^[a-z][a-z0-9-]*$`, 1–63 chars
- [ ] `metadata.org` is set appropriately for the user's context

**Tool names**
- [ ] Tool names in `default_enabled_tools` and `default_tool_approvals` have been verified or annotated as needing verification

For full field details, read `references/schema.md`. For examples of any pattern, read `references/examples.md`.

### Step 6 — Explain agent integration

After presenting the McpServer YAML, always explain how an agent references it. Keep this concise; read `references/agent-integration.md` for the full details if the user asks for more.

Minimum integration snippet:
```yaml
# In Agent spec
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: <slug>        # metadata.slug from the McpServer (auto-derived from name)
      enabled_tools:        # optional — restrict to a subset; empty = use McpServer defaults
        - <tool-name>
      tool_approval_overrides:   # optional — add/remove approvals for this specific agent
        - tool_name: <tool-name>
          requires_approval: false   # disable a McpServer default for a trusted agent
```

Key points to convey:
- `kind: mcp_server` (snake_case) in the agent reference is different from `kind: McpServer` (PascalCase) in the resource YAML — both are correct for their context
- The agent contains no secrets — secrets come from the AgentInstance's environment binding
- `enabled_tools` can only restrict the McpServer's `default_enabled_tools`, not expand it
- The three-layer approval chain: McpServer → Agent overrides → execution `auto_approve_all`

---

## Common Mistakes — Quick Reference

| Mistake | Effect | Fix |
|---|---|---|
| `kind: mcpserver` | Validation failure | Use `kind: McpServer` |
| `apiVersion: stigmer.ai/v1` | Validation failure | Use `apiVersion: agentic.stigmer.ai/v1` |
| Both `stdio` and `http` present | Validation failure | Keep exactly one |
| Neither `stdio` nor `http` present | Validation failure | Add one |
| `message: "Delete ${args.repo}"` | Placeholder not resolved | Use `{{args.repo}}` in approval messages |
| `headers: Authorization: "{{TOKEN}}"` | Placeholder not resolved | Use `${TOKEN}` in HTTP headers |
| `value: ghp_abc123` in `env_spec` | Secret leaked to spec | Leave `value` empty |
| Guessed tool names | Silently ignored | Run discovery; copy names from status |
| `slug: MyServer` | Slug validation failure | Use `slug: my-server` (lowercase, hyphens) |
| `status.validation_state: valid` in YAML | Overwritten silently | Never set status fields |
