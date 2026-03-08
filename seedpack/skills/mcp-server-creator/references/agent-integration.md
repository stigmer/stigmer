# Agent Integration Reference

How agents reference McpServers, the tool approval policy chain, sub-agent access, and the full runtime resolution flow.

## McpServerUsage in Agent Spec

Agents declare MCP server usage via `spec.mcp_server_usages`:

```yaml
# In Agent spec
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server           # snake_case (NOT McpServer)
        slug: github               # matches McpServer metadata.slug
      enabled_tools:               # optional — subset of default_enabled_tools
        - search_code
        - get_file_contents
        - create_pull_request
      tool_approval_overrides:     # optional — per-agent customization
        - tool_name: delete_repository
          requires_approval: true
          message: "Delete repository: {{args.repo_name}}"
```

### McpServerUsage Fields

| Field | Required | Description |
|---|---|---|
| `mcp_server_ref` | Yes | Reference with `kind: mcp_server` and `slug`. Add `org` for cross-org references. |
| `enabled_tools` | No | Tools to enable. Empty = use McpServer's `default_enabled_tools` (or all if not set). Cannot expand beyond McpServer's gate. |
| `tool_approval_overrides` | No | Per-agent approval policy customization (see below). |

The `mcp_server_ref.slug` must be **unique** within a single agent's `mcp_server_usages`.

### Reference Format

```yaml
# Relative reference (recommended) — org resolved from agent's metadata.org
mcp_server_ref:
  kind: mcp_server
  slug: github

# Absolute reference — for cross-org or marketplace servers
mcp_server_ref:
  org: stigmer
  kind: mcp_server
  slug: github
```

Canonical format: `org/slug` (e.g., `stigmer/github`, `acme-corp/internal-db`).

## Three-Layer Approval Policy Chain

Approval policies resolve in order of increasing priority:

```
McpServer.default_tool_approvals          ← base layer (all agents)
        │
        ▼ overrides
Agent.McpServerUsage.tool_approval_overrides  ← per-agent layer
        │
        ▼ overrides
AgentExecution.auto_approve_all           ← runtime bypass
```

| Priority | Source | Scope |
|---|---|---|
| 1 (lowest) | `McpServer.default_tool_approvals` | All agents using this server |
| 2 | `Agent.tool_approval_overrides` | Single agent |
| 3 (highest) | `AgentExecution.auto_approve_all` | Single execution (runtime) |

### ToolApprovalOverride Fields

| Field | Required | Description |
|---|---|---|
| `tool_name` | Yes | Exact tool name (case-sensitive) |
| `requires_approval` | Yes | `true` = requires approval; `false` = no approval (overrides McpServer default) |
| `message` | No | Custom approval prompt. If empty: inherits McpServer message or auto-generates. |

### Override Examples

**Trusted agent — disable McpServer defaults:**
```yaml
tool_approval_overrides:
  - tool_name: delete_repository
    requires_approval: false
  - tool_name: force_push
    requires_approval: false
```

**Stricter agent — add approvals McpServer doesn't require:**
```yaml
tool_approval_overrides:
  - tool_name: send_email
    requires_approval: true
    message: "Send email to {{args.recipient}}: {{args.subject}}"
  - tool_name: create_ticket
    requires_approval: true
    message: "Create support ticket for customer"
```

## Sub-Agent MCP Access

Sub-agents can only access MCP servers the parent has in `mcp_server_usages`. Access is granted via `mcp_access`:

```yaml
sub_agents:
  - name: code-reviewer
    description: "Reviews code changes"
    instructions: "You review code changes for quality..."
    mcp_access:
      - mcp_server: github         # slug from parent's mcp_server_usages
        enabled_tools:             # subset of parent's enabled_tools
          - search_code
          - get_file
```

| McpAccess Field | Description |
|---|---|
| `mcp_server` | Slug matching `mcp_server_ref.slug` from parent's usages |
| `enabled_tools` | Tools for this sub-agent (subset of parent's). Empty = all parent tools. |

## Runtime Resolution Flow

1. **Agent** declares `mcp_server_usages` (references only — no secrets)
2. **AgentInstance** binds Agent to Environment (provides actual credential values)
3. **Agent Runner** resolves each McpServer ref, retrieves secrets from Environment, starts MCP server process
4. Tools become available during AgentExecution

The McpServer YAML is **portable and secret-free**. Different AgentInstances bind the same Agent to different environments (staging vs production).

## Post-Apply Workflow

```bash
# 1. Apply the McpServer
stigmer apply -f mcpserver.yaml

# 2. Discover tools (connects locally, pushes metadata to platform)
stigmer discover mcp-server <slug>

# 3. Verify discovered tools
stigmer get mcp-server <slug> --output yaml
# Check status.discovered_capabilities.tools[*].name

# 4. Use discovered names in default_enabled_tools, default_tool_approvals, and agent enabled_tools
```

Discovery runs on the developer's machine — credentials never leave the local environment. Only tool metadata (names, descriptions, schemas) is sent to the platform.
