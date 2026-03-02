# Agent Integration: Referencing McpServers from Agents

How agents declare and restrict access to McpServer resources, and how the tool availability and approval policy chain works end-to-end.

## The Runtime Flow

```
McpServer  →  Agent (mcp_server_usages)  →  AgentInstance (env binding)  →  AgentExecution (agent runner starts server)
```

1. **McpServer** — declares the connection config, credential schema, default tool set, and default approval policies.
2. **Agent** — references one or more McpServers via `mcp_server_usages`. Can restrict tools and customize approvals.
3. **AgentInstance** — binds the Agent to an Environment that provides actual credential values. No secrets in Agent or McpServer YAML.
4. **AgentExecution** — the agent runner resolves the McpServer config, injects secrets from the environment, and starts the server process.

## McpServerUsage Fields

Declared in `Agent.spec.mcp_server_usages`.

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local          # McpServer's metadata.org
        kind: mcp_server    # always "mcp_server" (snake_case) in references
        slug: github        # McpServer's metadata.slug
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
      tool_approval_overrides:
        - tool_name: merge_pull_request
          requires_approval: false   # this agent trusts itself to merge
        - tool_name: create_pull_request
          requires_approval: true
          message: "Create PR in {{args.repo}}: {{args.title}}"
```

| Field | Required | Description |
|---|---|---|
| `mcp_server_ref` | Yes | Reference to the McpServer resource. |
| `mcp_server_ref.org` | Yes | Must match `McpServer.metadata.org` exactly. |
| `mcp_server_ref.kind` | Yes | Always `mcp_server` (snake_case in references). |
| `mcp_server_ref.slug` | Yes | Must match `McpServer.metadata.slug`. Uniqueness: one slug per agent's `mcp_server_usages`. |
| `enabled_tools` | No | Tools to enable. Empty = use McpServer's `default_enabled_tools` (or all if not set). Agents can only restrict, not expand. |
| `tool_approval_overrides` | No | Per-agent approval customization (see below). |

### Note on `kind` in References vs Resources

This is a common source of confusion:

| Location | `kind` value |
|---|---|
| McpServer top-level resource `kind:` | `McpServer` (PascalCase) |
| `mcp_server_ref.kind` in Agent | `mcp_server` (snake_case) |

These are different field types — PascalCase is the resource's kind string; snake_case is the enum reference kind.

## Tool Availability: The Restriction Chain

Tools flow down from the McpServer to the agent, and can only be restricted — never expanded:

```
McpServer.default_enabled_tools  (the ceiling for ALL agents)
        ↓ (agents can use any subset)
Agent.mcp_server_usages[*].enabled_tools  (agent-level restriction)
        ↓ (sub-agents can use any subset of parent's tools)
SubAgent.mcp_access[*].enabled_tools  (sub-agent restriction)
```

**Scenarios:**

| McpServer `default_enabled_tools` | Agent `enabled_tools` | Result |
|---|---|---|
| `[]` (empty) | `[]` (empty) | Agent gets all tools the server reports |
| `[search_code, create_pr, delete_repo]` | `[]` (empty) | Agent gets `search_code`, `create_pr`, `delete_repo` |
| `[search_code, create_pr, delete_repo]` | `[search_code]` | Agent gets only `search_code` |
| `[search_code, create_pr]` | `[create_pr, delete_repo]` | Agent gets only `create_pr` — `delete_repo` is not in McpServer defaults so it cannot be enabled |

An agent cannot use tools that are not in `McpServer.default_enabled_tools`. The McpServer owner sets the ceiling.

## Tool Approval Overrides

Per-agent customization of which tools need human approval before the agent runner executes them.

```yaml
tool_approval_overrides:
  - tool_name: delete_repository
    requires_approval: false   # override McpServer default (it requires approval)
  - tool_name: execute_sql
    requires_approval: true    # add approval even though McpServer doesn't require it
    message: "Execute SQL: {{args.query}}"
  - tool_name: send_email
    requires_approval: true
    # no message → inherits from McpServer's default_tool_approvals message (if any)
    # or falls back to auto-generated "Execute tool: send_email"
```

### ToolApprovalOverride Fields

| Field | Required | Description |
|---|---|---|
| `tool_name` | Yes | Exact, case-sensitive match with server's tool name. |
| `requires_approval` | Yes | `true`: this agent requires approval. `false`: no approval (overrides McpServer default). |
| `message` | No | Custom message for this agent's context. Overrides McpServer message. |

### Message Inheritance

When `requires_approval: true` and `message` is empty:
1. Uses McpServer's `default_tool_approvals` message for this tool (if present)
2. Otherwise auto-generates: `"Execute tool: {tool_name}"`

When `message` is provided, it overrides the McpServer message.

### Silent Failure for Invalid Tool Names

If a `tool_name` doesn't match any tool in the server's `tools/list`, the override is silently ignored. **Always verify tool names before writing overrides.**

## The Three-Layer Approval Policy Chain

```
Layer 1 (lowest):   McpServer.default_tool_approvals
                    Applies to all agents — set by the McpServer owner
        ↓
Layer 2:            Agent.mcp_server_usages[*].tool_approval_overrides
                    Per-agent — can add or remove requirements
        ↓
Layer 3 (highest):  AgentExecution.auto_approve_all = true
                    Runtime bypass — set on AgentExecution, not in YAML
                    Skips all approvals for trusted automation pipelines
```

An override at Layer 2 fully supersedes Layer 1 for that tool in that agent.

## Sub-Agent Access (McpAccess)

Sub-agents inherit the parent's MCP server usages but can only access servers explicitly granted.

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
        - merge_pull_request
  sub_agents:
    - name: code-reviewer
      description: "Reviews code for quality and security issues"
      instructions: "You review code changes. Focus on correctness, security, and style."
      mcp_access:
        - mcp_server: github    # uses slug (not the full ref), must match parent's mcp_server_ref.slug
          enabled_tools:
            - search_code
            - get_file_contents
            # create_pull_request and merge_pull_request NOT granted — reviewer only reads
```

Sub-agent `mcp_access.mcp_server` uses the slug directly (not the full `ApiResourceReference`). The slug must match one of the parent's `mcp_server_usages[*].mcp_server_ref.slug`.

Sub-agent tools must be a subset of what the parent has enabled. A sub-agent cannot expand tool access.

## Complete Agent YAML with McpServer Integration

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-review-assistant
  org: local
spec:
  description: "Code review assistant with GitHub integration"
  instructions: |
    You are a code review assistant. You help review pull requests,
    search code, and understand repository structure. You do not
    create or delete repositories without explicit user instruction.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file_contents
        - list_issues
        - create_issue
        - get_pull_request
        - list_pull_requests
      tool_approval_overrides:
        - tool_name: create_issue
          requires_approval: true
          message: "Create issue in {{args.repo}}: {{args.title}}"
```
