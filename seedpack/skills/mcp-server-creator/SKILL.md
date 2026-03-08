---
name: mcp-server-creator
description: >
  Creates and validates Stigmer McpServer YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill when a user wants to:
  - Create a new McpServer resource for any external tool integration
    (GitHub, Slack, PostgreSQL, custom HTTP services, etc.)
  - Configure tool availability (default_enabled_tools) or approval policies
    (default_tool_approvals) for an existing or new McpServer
  - Understand how an MCP server connects to agents via mcp_server_usages
  - Validate or troubleshoot an existing McpServer YAML
  This skill covers both stdio (subprocess) and http (remote service) transport types.
---

# MCP Server Creator

Produces valid, production-quality `agentic.stigmer.ai/v1` McpServer YAML files.

## Workflow

Follow these six steps in order. Never skip step 5 (validation).

### Step 1 — Understand the Integration

Before writing any YAML, gather:

1. **External system**: What does this MCP server connect to? (GitHub, Slack, a database, an internal API?)
2. **Transport type**: Is this a CLI-based server started as a subprocess (`stdio`), or a remote service already running over the network (`http`)?
   - Default to `stdio` for any `npx`, `python -m`, or binary-based server
   - Use `http` only for services with a persistent HTTP endpoint
3. **Credentials**: What API keys, tokens, or connection strings does it need?
   - Which are secret (encrypted, redacted in logs)?
   - Which are non-secret configuration values?
4. **Tools**: Does the user know which tools the server exposes? (If not, they can discover them after applying)
5. **Safety constraints**: Are there destructive operations that should require human approval by default?
6. **Scope**: Is this for the user's org only (`visibility_private`) or for the marketplace (`visibility_public`)?

Ask only the questions needed to fill gaps. If the user says "create a GitHub MCP server," you already know enough to write a solid first draft.

### Step 2 — Choose the Right Server Type

**Use `stdio`** (most common) when:
- The server is a Node.js package: `npx @modelcontextprotocol/server-github`
- The server is a Python module: `python -m mcp_server_sqlite`
- The server is a compiled binary on disk
- The server is for local or single-agent use

**Use `http`** when:
- There is already a running service with an HTTP endpoint
- The service is shared across many concurrent agents
- The server is behind an API gateway or reverse proxy

### Step 3 — Draft the YAML

Use `references/schema.md` for the full field reference. Key rules:

**Top-level (always):**
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer          # exact PascalCase — never mcpserver, mcp_server, etc.
metadata:
  name: <human-readable-name>
  org: default           # or explicit org slug — required for cloud
spec:
  description: "<what it does and why>"
  stdio: ...             # exactly one of stdio or http
```

**env_spec — schema only, never values for secrets:**
```yaml
env_spec:
  data:
    MY_TOKEN:
      description: "Token with X scope"
      is_secret: true    # encrypted, redacted in logs
    MY_REGION:
      description: "AWS region (e.g., us-east-1)"
      is_secret: false   # plaintext
```

**default_enabled_tools — only if you know real tool names:**
```yaml
default_enabled_tools:
  - search_code          # must match tools/list output exactly
  - get_file_contents
```

**default_tool_approvals — for destructive or sensitive operations:**
```yaml
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete repository: {{args.repo}}"    # {{args.field}} syntax
```

**HTTP servers — use `${VAR_NAME}` for env var substitution (not `{{}}`):**
```yaml
http:
  url: "https://api.example.com/mcp"
  headers:
    Authorization: "Bearer ${API_TOKEN}"     # ${VAR} — resolved from AgentInstance env
```

See `references/examples.md` for complete annotated examples for every pattern.

### Step 4 — Configure Tool Safety

Help the user decide what goes in `default_tool_approvals`:

- **Destructive operations** (delete, drop, truncate, force-push): always require approval
- **Irreversible communications** (send email, post message): usually require approval
- **Read-only operations** (search, get, list, describe): approval is usually unnecessary
- **Write operations that can be reviewed** (create PR, create issue): judgment call

For the approval `message`:
- Use `{{args.field_name}}` to show actual argument values at approval time
- Check the tool's `input_schema.properties` keys (from discovery) for valid field names
- Keep under 100 characters
- Use action verbs: "Delete", "Send", "Execute", "Create"

If the user doesn't know exact tool names yet, write the YAML with a placeholder note and remind them to run discovery.

### Step 5 — Validate (Always)

Before presenting the final YAML, verify every item in `references/validation-checklist.md`.

**The seven critical checks:**
1. `apiVersion: agentic.stigmer.ai/v1` — exact string
2. `kind: McpServer` — PascalCase exactly
3. Exactly one of `stdio` or `http` in `spec`
4. No secret values pre-filled in `env_spec`
5. No `status` fields set by the user
6. `${VAR_NAME}` only in HTTP headers/params; `{{args.field}}` only in approval messages
7. Tool names flagged as unverified if not confirmed from `tools/list`

### Step 6 — Explain Agent Integration

After delivering the McpServer YAML, explain how an agent references it:

```yaml
# In Agent spec — referencing the McpServer by slug
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server     # snake_case in references (different from resource kind)
        slug: github         # matches McpServer metadata.slug
      enabled_tools:         # optional — restricts agent to subset of default_enabled_tools
        - search_code
        - get_file_contents
      tool_approval_overrides:  # optional — per-agent approval customization
        - tool_name: merge_pull_request
          requires_approval: false   # trust this agent
```

And give the CLI commands to complete the workflow:
```bash
# 1. Apply the McpServer
stigmer apply -f mcpserver.yaml

# 2. Discover tools (populates status.discovered_capabilities)
stigmer discover mcp-server <slug>

# 3. Verify — check validation_state and tool names
stigmer get mcp-server <slug> --output yaml
```

---

## Reference Files

Load these when you need detailed information:

- **`references/schema.md`** — Complete field reference for every McpServer field, derived from the proto definitions. Load when you need precise field constraints, allowed values, or details about stdio vs http config.

- **`references/examples.md`** — Annotated YAML examples from minimal to marketplace-ready (GitHub, PostgreSQL, Slack, HTTP service, multi-tenant). Load when constructing a YAML or when the user asks for an example to start from.

- **`references/agent-integration.md`** — How agents reference McpServers via `mcp_server_usages`, how `enabled_tools` restricts tool access, how `tool_approval_overrides` customizes the approval chain, and how sub-agents get scoped MCP access. Load when the user asks about agent-side configuration after creating the McpServer.

- **`references/validation-checklist.md`** — Pre-apply checklist and detailed pitfall explanations (wrong kind case, both/neither server types, syntax confusion, silent tool name failures). Load during step 5 validation or when debugging a broken YAML.

---

## Key Constraints Summary

| Rule | Detail |
|---|---|
| `apiVersion` | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Must be exactly `McpServer` |
| Server type | Exactly one of `stdio` or `http` — proto `oneof required` |
| Slug format | `^[a-z][a-z0-9-]*$`, 1–63 chars — no underscores, no uppercase |
| Secret values | Never pre-fill in McpServer spec — values belong in AgentInstance |
| Tool names | Case-sensitive, must match `tools/list` exactly — silent ignore if wrong |
| HTTP env vars | `${VAR_NAME}` syntax in headers/params |
| Approval messages | `{{args.field}}` syntax — not `${}` |
| Status fields | Never set by users |
