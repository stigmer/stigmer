# Agent Integration Guide

How agents reference McpServers, restrict tools, customize approval policies, and grant sub-agent access.

Source: `ai/stigmer/agentic/agent/v1/spec.proto` — `McpServerUsage`, `ToolApprovalOverride`, `McpAccess`.

## Table of Contents
1. [Basic Reference Pattern](#basic-reference-pattern)
2. [McpServerUsage Fields](#mcpserverusage-fields)
3. [Tool Restriction (enabled_tools)](#tool-restriction)
4. [Tool Approval Overrides](#tool-approval-overrides)
5. [Sub-Agent Access](#sub-agent-access)
6. [Runtime Resolution Flow](#runtime-resolution-flow)

---

## Basic Reference Pattern

Reference a McpServer from an Agent using its `slug` (the URL-friendly identifier):

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: acme-corp
spec:
  instructions: "You are a code review assistant..."
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server        # always mcp_server (snake_case) in ref
        slug: github            # matches McpServer metadata.slug
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
```

**Cross-org reference** (referencing a public/marketplace server):
```yaml
    - mcp_server_ref:
        org: stigmer            # publisher org
        kind: mcp_server
        slug: github
```

**Note:** `kind: McpServer` (PascalCase) is used in the McpServer resource itself.
`kind: mcp_server` (snake_case) is used in `ApiResourceReference` within Agent YAML.
Both are correct for their respective contexts.

---

## McpServerUsage Fields

| Field | Required | Description |
|---|---|---|
| `mcp_server_ref` | Yes | Reference to the McpServer resource. `kind` must be `mcp_server`. |
| `enabled_tools` | No | Tools the agent can use. Empty = use McpServer's `default_enabled_tools` (or all if not set). Must be a subset of the McpServer's `default_enabled_tools`. |
| `tool_approval_overrides` | No | Per-agent approval policy customization. Overrides McpServer defaults. |

The `mcp_server_ref.slug` must be **unique** within a single agent's `mcp_server_usages` — you cannot reference the same McpServer twice.

---

## Tool Restriction

`enabled_tools` defines the maximum tool set for this agent from this server.

```yaml
# Agent restricts to only read-only tools from GitHub
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github
    enabled_tools:
      - search_code
      - get_file_contents
      - list_issues
      # merge_pull_request, delete_repository, etc. are excluded

# Agent uses all of McpServer's default_enabled_tools (most common)
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github
    # no enabled_tools — inherits McpServer's default_enabled_tools
```

**Tool availability chain:**

| Layer | Control |
|---|---|
| McpServer `default_enabled_tools` | Platform ceiling — agents can only restrict, not expand |
| Agent `enabled_tools` | Agent-level restriction (subset of McpServer defaults) |
| Sub-agent `mcp_access.enabled_tools` | Sub-agent restriction (subset of agent's enabled_tools) |

---

## Tool Approval Overrides

Agents can add or remove approval requirements from the McpServer's defaults.

```yaml
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github
    tool_approval_overrides:
      # Remove approval for merge_pull_request (trusted deployment agent)
      - tool_name: merge_pull_request
        requires_approval: false

      # Add approval for create_issue (not in McpServer defaults)
      - tool_name: create_issue
        requires_approval: true
        message: "Create GitHub issue: {{args.title}} in {{args.repo}}"
```

`ToolApprovalOverride` fields:

| Field | Required | Description |
|---|---|---|
| `tool_name` | Yes | Exact tool name (case-sensitive). Silent failure if wrong. |
| `requires_approval` | Yes | `true` = add approval requirement. `false` = remove McpServer default. |
| `message` | No | Custom prompt. Overrides McpServer default message when `requires_approval: true`. |

**Message inheritance when `requires_approval: true` and no message:**
1. Uses McpServer's `default_tool_approvals` message for this tool (if exists)
2. Otherwise auto-generates: `"Execute tool: {tool_name}"`

**The three-layer approval chain:**
```
McpServer.default_tool_approvals   ← lowest priority (applies to all agents)
        ↓ overridden by
Agent.tool_approval_overrides      ← per-agent customization
        ↓ overridden by
AgentExecution.auto_approve_all    ← runtime bypass (trusted pipelines, not set in YAML)
```

---

## Sub-Agent Access

Sub-agents can only access MCP servers declared in the parent agent's `mcp_server_usages`. The slug from `mcp_server_ref` is the identifier used in `mcp_access.mcp_server`.

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github         # parent has full access
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
        - merge_pull_request

  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes for quality and security"
      instructions: "You review code changes. Focus on security and best practices..."
      mcp_access:
        - mcp_server: github              # matches mcp_server_ref.slug above
          enabled_tools:
            - search_code
            - get_file_contents
            # create_pull_request and merge_pull_request NOT granted to sub-agent

    - name: release-manager
      description: "Manages PR merging and releases"
      instructions: "You manage the release process. Only merge PRs that pass review..."
      mcp_access:
        - mcp_server: github
          # no enabled_tools restriction — gets all of parent's enabled_tools
```

`McpAccess` fields:

| Field | Required | Description |
|---|---|---|
| `mcp_server` | Yes | Slug of the McpServer — must match `mcp_server_ref.slug` from parent's `mcp_server_usages`. |
| `enabled_tools` | No | Further restriction. Must be a subset of parent's `enabled_tools`. Empty = all of parent's enabled tools. |

---

## Runtime Resolution Flow

The Agent YAML contains references, not connections or secrets. Runtime flow:

```
Agent YAML (mcp_server_ref) 
    ↓  resolved by
AgentInstance (binds Agent + Environment with actual credential values)
    ↓  used by
Agent Runner (resolves McpServer spec, injects env vars, starts/connects server)
    ↓  provides
Running MCP Server (tools available during AgentExecution)
```

This separation means:
- Agent YAML is portable and contains zero secrets
- Same Agent + different AgentInstance = different environment (dev vs prod)
- AgentInstance holds the actual `GITHUB_TOKEN` value — McpServer only declares that it's required
