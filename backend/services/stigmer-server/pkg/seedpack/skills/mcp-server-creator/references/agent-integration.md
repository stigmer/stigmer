# Agent Integration — Referencing McpServers from Agents

After creating an McpServer, agents reference it via `spec.mcp_server_usages`. This is the consumer-side view of the McpServer you just created.

## How Agents Reference McpServers

```yaml
# In an Agent YAML
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local          # matches McpServer metadata.org
        kind: mcp_server    # always snake_case here (different from McpServer's kind: McpServer)
        slug: github        # matches McpServer metadata.slug (auto-generated from name if not set)
      enabled_tools:        # optional — restricts which tools this agent can use
        - search_code
        - get_file_contents
        - create_pull_request
      tool_approval_overrides:  # optional — per-agent approval customization
        - tool_name: merge_pull_request
          requires_approval: false   # disable McpServer default approval for this agent
        - tool_name: execute_sql
          requires_approval: true
          message: "Execute SQL: {{args.query}}"   # add approval not in McpServer defaults
```

## McpServerUsage Fields

| Field | Required | Notes |
|---|---|---|
| `mcp_server_ref` | Yes | Reference with `org`, `kind: mcp_server`, and `slug` |
| `enabled_tools` | No | Empty = use McpServer's `default_enabled_tools` (or all if that's empty). Non-empty = subset of what the McpServer allows — agents can only restrict, never expand. |
| `tool_approval_overrides` | No | Per-agent approval customization (see below) |

The `mcp_server_ref.slug` must be **unique** within an agent's `mcp_server_usages` — you cannot reference the same server twice.

## Tool Approval Overrides (Agent Layer)

| Field | Required | Notes |
|---|---|---|
| `tool_name` | Yes | Exact name (case-sensitive) — typos silently ignored |
| `requires_approval` | Yes | `true` adds approval; `false` disables a McpServer default |
| `message` | No | If empty and `requires_approval: true`, inherits McpServer default message, or auto-generates `"Execute tool: {tool_name}"` |

## Tool Availability Chain

```
McpServer.default_enabled_tools
    → Agent.McpServerUsage.enabled_tools (can only restrict further)
        → What the agent's model sees as callable tools
```

## Approval Policy Chain

```
McpServer.default_tool_approvals        (platform defaults — lowest priority)
    → Agent.McpServerUsage.tool_approval_overrides  (per-agent layer)
        → AgentExecution.auto_approve_all           (runtime bypass — highest priority)
```

## Runtime Resolution

The Agent YAML contains **no secrets** — only references. At runtime:

1. **Agent** declares `mcp_server_usages` (references only)
2. **AgentInstance** binds the Agent to an Environment (provides actual credentials)
3. **Agent Runner** resolves each McpServer reference, retrieves secrets, starts the server
4. Tools become available to the agent during the AgentExecution

This separation means the same Agent YAML can run against different environments (e.g., staging vs production) by binding to different AgentInstances.

## Slug Note

`kind: McpServer` (PascalCase) is correct in the McpServer resource YAML.
`kind: mcp_server` (snake_case) is correct in `mcp_server_ref` inside an Agent.
Both are correct — different contexts, different casing conventions.
