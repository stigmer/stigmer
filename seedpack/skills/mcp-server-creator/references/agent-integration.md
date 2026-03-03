# Agent Integration — Referencing McpServers from Agents

How agents consume McpServers via `mcp_server_usages`, restrict tool access, and customize approval policies.

## The Resource Chain

```
McpServer ──► Agent ──► AgentInstance ──► AgentExecution
```

- **McpServer** — declares the connection template and tool defaults
- **Agent** — references McpServers and restricts which tools each agent can use
- **AgentInstance** — binds secrets/credentials from an Environment at runtime
- **AgentExecution** — a single run; can bypass all approvals with `auto_approve_all: true`

The Agent YAML contains no secrets. Secrets live in the AgentInstance's environment binding.

---

## mcp_server_usages

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: acme-corp
spec:
  instructions: "You review code changes for quality, security, and best practices."
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github          # matches McpServer metadata.slug
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
      tool_approval_overrides:
        - tool_name: merge_pull_request
          requires_approval: true
          message: "Agent wants to merge PR #{{args.pull_number}} in {{args.repo}}"
```

### McpServerUsage fields

| Field | Required | Notes |
|---|---|---|
| `mcp_server_ref` | **Yes** | Reference to the McpServer resource. Must have `kind: mcp_server`. |
| `mcp_server_ref.slug` | **Yes** | The `slug` from the McpServer's `metadata`. |
| `mcp_server_ref.org` | No | The publishing org. Omit for servers in your own org; set for public/cross-org servers. |
| `mcp_server_ref.kind` | **Yes** | Must be `mcp_server` (snake_case — different from `kind: McpServer` in the resource itself). |
| `enabled_tools` | No | Subset of `McpServer.default_enabled_tools`. Empty = use the McpServer's defaults. |
| `tool_approval_overrides` | No | Per-agent approval customization. See below. |

**Key constraints:**
- Each MCP server slug must be unique within a single agent's `mcp_server_usages`
- `enabled_tools` can only restrict — it cannot add tools not in `default_enabled_tools`
- Tool names are case-sensitive; typos silently ignore that tool

---

## Tool Availability Chain

| Layer | Field | Effect |
|---|---|---|
| McpServer | `default_enabled_tools` | Platform ceiling — what any agent can ever enable |
| Agent | `enabled_tools` | Per-agent restriction — a subset of the McpServer's default |
| SubAgent | `mcp_access[*].enabled_tools` | Per-sub-agent restriction — subset of the parent Agent's tools |

An empty `enabled_tools` at the Agent level means "use the McpServer's `default_enabled_tools`". An empty `default_enabled_tools` on the McpServer means "all tools are available".

---

## tool_approval_overrides

Per-agent layer of the three-layer approval chain. Takes precedence over `McpServer.default_tool_approvals`.

```yaml
tool_approval_overrides:
  # Add approval where McpServer has none
  - tool_name: execute_query
    requires_approval: true
    message: "Execute SQL on production: {{args.query}}"

  # Remove approval where McpServer requires it (trust this agent)
  - tool_name: merge_pull_request
    requires_approval: false

  # Override the message (inherit McpServer's requires_approval: true)
  - tool_name: delete_repository
    requires_approval: true
    message: "CI bot will delete repo: {{args.repo}} — confirm?"
```

### ToolApprovalOverride fields

| Field | Required | Notes |
|---|---|---|
| `tool_name` | **Yes** | Exact tool name (case-sensitive). Typos silently skip the override. |
| `requires_approval` | **Yes** | `true` = add approval; `false` = remove approval (overrides McpServer default). |
| `message` | No | Custom message. If empty and `requires_approval: true`, inherits McpServer's message, then auto-generates `"Execute tool: {tool_name}"`. |

---

## Full Approval Policy Chain

| Priority | Source | Description |
|---|---|---|
| 1 (lowest) | `McpServer.default_tool_approvals` | Org-wide baseline |
| 2 | `Agent.McpServerUsage.tool_approval_overrides` | Per-agent customization |
| 3 (highest) | `AgentExecution.auto_approve_all: true` | Runtime bypass for trusted pipelines |

---

## Referencing a Public (Cross-Org) McpServer

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: stigmer        # publisher's org
        kind: mcp_server
        slug: github        # server's slug in that org
      enabled_tools:
        - search_code
        - get_file_contents
```

---

## Sub-Agent Access

SubAgents inherit the parent's MCP servers and can only restrict access further.

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools: [search_code, get_file_contents, create_pull_request, merge_pull_request]

  sub_agents:
    - name: code-reader
      description: "Read-only code analysis sub-agent"
      instructions: "You read and analyze code. You never modify repositories."
      mcp_access:
        - mcp_server: github             # must match slug from parent's mcp_server_usages
          enabled_tools:
            - search_code
            - get_file_contents          # subset of parent's enabled_tools only
```

`mcp_access[*].mcp_server` uses the slug string (not a reference object).

---

## Runtime Flow

1. Agent YAML declares `mcp_server_usages` (no secrets, no connections)
2. AgentInstance binds Agent + Environment (provides actual credential values)
3. Agent runner reads the McpServer spec, resolves credentials from the Environment
4. For stdio: runner spawns subprocess with credentials injected as env vars
5. For http: runner sends requests with credential-substituted headers/params
6. MCP server tools become available to the agent during execution

The Agent YAML is fully portable — promote from dev to prod by swapping the AgentInstance's environment binding, not the Agent YAML.
