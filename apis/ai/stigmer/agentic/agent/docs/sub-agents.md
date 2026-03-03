# Sub-Agents

How Agents delegate to specialized sub-agents, including MCP access grants and the permission model.

## What Are Sub-Agents?

Sub-agents enable delegation: the parent agent can route specialized tasks to focused sub-agents. Each sub-agent has its own instructions, skills, and a restricted view of the parent's MCP server access.

Sub-agents are defined inline within the parent Agent YAML — they are not separate resources.

## Defining Sub-Agents

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
        - create_issue

  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes for quality and security"
      instructions: |
        You review code changes. Focus on:
        - Security vulnerabilities
        - Performance issues
        - Code style consistency
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
      skill_refs:
        - kind: skill
          slug: code-review-best-practices
```

## SubAgent Fields

Defined by `SubAgent` in `ai/stigmer/agentic/agent/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier within the parent agent. Used for delegation routing and logging. Examples: `code-reviewer`, `researcher`, `writer`. |
| `description` | No | Helps the parent agent decide when to delegate to this sub-agent. Should clearly describe the sub-agent's specialization. |
| `instructions` | Yes | System prompt for the sub-agent. Minimum 10 characters (enforced by `buf.validate`). Defines the sub-agent's expertise and constraints. |
| `mcp_access` | No | MCP server access grants. See [MCP Access](#mcp-access) below. |
| `skill_refs` | No | Skills for this sub-agent. Independent of parent — can reference any skill. See [skill-integration.md](skill-integration.md). |

## MCP Access

`mcp_access` grants a sub-agent access to one or more of the parent's MCP servers. Each entry uses the `McpAccess` message.

```yaml
mcp_access:
  - mcp_server: github
    enabled_tools:
      - search_code
      - get_file
  - mcp_server: slack
    # enabled_tools empty = all tools from parent for this server
```

### McpAccess Fields

Defined by `McpAccess` in `ai/stigmer/agentic/agent/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `mcp_server` | Yes | Slug of the MCP server to grant access to. Must match `mcp_server_ref.slug` from one of the parent's `mcp_server_usages`. |
| `enabled_tools` | No | Tools this sub-agent can use. Must be a **subset** of the parent's `enabled_tools` for this server. Empty list = all tools that the parent has enabled (no additional restriction). |

## Permission Model

The sub-agent permission model enforces strict containment — sub-agents can never exceed their parent's access.

### MCP Server Access

- Sub-agents can **only** access MCP servers that the parent has in `mcp_server_usages`.
- The `mcp_server` field in `mcp_access` must match a slug from the parent's MCP server references.
- If a sub-agent has no `mcp_access` entries, it has no MCP server access at all.

### Tool Restriction

- Sub-agent `enabled_tools` must be a **subset** of the parent's enabled tools for that MCP server.
- Sub-agents can **restrict** tools (allow fewer than the parent), but can never **expand** (allow tools the parent doesn't have).
- An empty `enabled_tools` list means "all tools the parent has for this server" — which is still bounded by the parent's configuration.

### Skill Independence

- Sub-agent `skill_refs` are **independent** of the parent agent's skills.
- A sub-agent can reference any Skill resource, including skills the parent does not use.
- This allows sub-agents to have specialized knowledge without loading it into the parent's context.

### Containment Summary

```
Parent Agent
├── mcp_server_usages: [github (4 tools), slack (3 tools)]
├── skill_refs: [style-guide, testing-guide]
│
├── Sub-Agent: code-reviewer
│   ├── mcp_access: github (2 of 4 tools)  ← restricted
│   └── skill_refs: [security-checklist]    ← independent
│
└── Sub-Agent: pr-creator
    ├── mcp_access: github (2 of 4 tools)  ← restricted
    └── skill_refs: []                      ← no skills needed
```

## Delegation Routing

The parent agent decides when to delegate using the sub-agent's `name` and `description`. Well-written descriptions help the parent make accurate delegation decisions:

```yaml
# Good — clear about what triggers delegation
description: "Reviews code changes for security vulnerabilities and coding standards"

# Poor — too vague for the parent to route effectively
description: "Handles code stuff"
```

The parent's `instructions` should describe how delegation works:

```yaml
instructions: |
  You coordinate engineering work. Delegate to sub-agents based on the task:
  - Code reviews go to the code-reviewer sub-agent
  - PR creation goes to the pr-creator sub-agent
  Handle general questions yourself.
```
