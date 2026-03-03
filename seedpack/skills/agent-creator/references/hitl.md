# Human-in-the-Loop (HITL) Tool Approval Guide

Approval policies add human checkpoints before an agent executes specific tools.
This document covers when to use them, how to configure them, and how to write
effective approval messages.

## Table of Contents
1. [Approval Policy Chain](#1-approval-policy-chain)
2. [When to Add Approvals](#2-when-to-add-approvals)
3. [Configuring tool_approval_overrides](#3-configuring-tool_approval_overrides)
4. [Writing Effective Approval Messages](#4-writing-effective-approval-messages)
5. [Silent Failure Risk](#5-silent-failure-risk)
6. [Common Patterns](#6-common-patterns)

---

## 1. Approval Policy Chain

Three layers, highest priority wins:

| Priority | Source | Scope |
|---|---|---|
| 1 (lowest) | `McpServer.default_tool_approvals` | Platform/org-wide default for that server |
| 2 | `Agent.mcp_server_usages[*].tool_approval_overrides` | Per-agent customization |
| 3 (highest) | `AgentExecution.auto_approve_all = true` | Runtime bypass (not in Agent YAML) |

The Agent layer (priority 2) can both add approvals the server doesn't require AND
remove approvals the server does require:

```yaml
tool_approval_overrides:
  - tool_name: send_email
    requires_approval: true   # ADD approval even if McpServer doesn't require it
  - tool_name: create_ticket
    requires_approval: false  # REMOVE approval that McpServer requires
```

---

## 2. When to Add Approvals

Add `requires_approval: true` for tools that:
- **Modify production state** (deploy, scale, delete, force-push)
- **Send external communications** (email, Slack, SMS)
- **Incur cost** (provision infrastructure, call paid APIs)
- **Are irreversible** (delete records, archive data)

Skip approvals for tools that:
- Are read-only (get_file, search_code, get_pod_status)
- Are always safe to auto-execute (fetch_page, search)
- Are in trusted automation pipelines (override at execution time via `auto_approve_all`)

---

## 3. Configuring tool_approval_overrides

Nested inside `mcp_server_usages[*]`:

```yaml
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github
    enabled_tools:
      - create_pr
      - delete_repository
    tool_approval_overrides:
      - tool_name: delete_repository    # exact name from discovered_capabilities
        requires_approval: true
        message: "Delete repository {{args.repo}} — this is permanent"
      - tool_name: create_pr
        requires_approval: false        # trusted; no approval needed
```

Fields defined by `ToolApprovalOverride` in `agent/v1/spec.proto`:

| Field | Required | Notes |
|---|---|---|
| `tool_name` | Yes | Exact, case-sensitive tool name (see §5) |
| `requires_approval` | Yes | `true` = require human approval; `false` = skip approval |
| `message` | No | Prompt shown to user; supports `{{args.field}}` |

---

## 4. Writing Effective Approval Messages

The `message` field supports `{{args.<field>}}` placeholders. Argument field names
come from the tool's `input_schema.properties` (visible in `discovered_capabilities`).

### Message guidelines

- Start with an action verb: "Delete", "Deploy", "Send", "Create"
- Include the most important argument values
- Keep under 100 characters for clean UI display
- Be specific to the risk, not just the action name

### Template examples

```yaml
# Deployment approval
message: "Deploy {{args.app_name}} v{{args.version}} to {{args.environment}}"

# Email approval
message: "Send email to {{args.recipient}}: {{args.subject}}"

# Database operation
message: "Execute SQL on {{args.database}}: {{args.query}}"

# Repository deletion
message: "Permanently delete repository {{args.owner}}/{{args.repo}}"

# Scale operation
message: "Scale {{args.deployment}} from {{args.current}} → {{args.replicas}} replicas"
```

### Message inheritance

When `requires_approval: true` and `message` is empty:
1. Uses the McpServer's `default_tool_approvals` message for that tool (if set)
2. Otherwise auto-generates: `"Execute tool: <tool_name>"`

When `message` is provided, it **overrides** the McpServer default message.

### Finding valid placeholder names

From `get_mcp_server` output, check:
```
status.discovered_capabilities.tools[name="<tool>"].input_schema.properties
```
Each property key is a valid `{{args.<key>}}` placeholder.

---

## 5. Silent Failure Risk

**This is the most dangerous pitfall in HITL configuration.**

If `tool_name` in `tool_approval_overrides` does not **exactly** match a tool name
from the MCP server's `tools/list`:
- The override is **silently ignored**
- No error is raised
- The approval policy simply does not apply
- A destructive tool may execute without approval

```yaml
# DANGEROUS — typo silently disables approval
tool_approval_overrides:
  - tool_name: delet_repository    # missing 'e' — silently ignored
    requires_approval: true
    message: "Delete repository {{args.repo}}"

# CORRECT
tool_approval_overrides:
  - tool_name: delete_repository   # exact name from discovered_capabilities
    requires_approval: true
    message: "Delete repository {{args.repo}}"
```

**Always verify tool names** from `status.discovered_capabilities.tools[*].name`
before writing overrides.

---

## 6. Common Patterns

### Trust an automation agent (disable all approval)

For a CI/CD pipeline that should never block on human approval:

```yaml
# Agent-level: disable approval for trusted agent
# (Better: set AgentExecution.auto_approve_all = true at runtime)
tool_approval_overrides:
  - tool_name: deploy_app
    requires_approval: false
  - tool_name: rollback_deployment
    requires_approval: false
```

### Add approval to customer-facing actions

```yaml
tool_approval_overrides:
  - tool_name: send_email
    requires_approval: true
    message: "Send customer email to {{args.recipient}}: {{args.subject}}"
  - tool_name: create_support_ticket
    requires_approval: true
    message: "Create ticket for {{args.customer_id}}: {{args.subject}}"
```

### Protect production while allowing staging

Use two separate agents with different approval policies — one for staging (permissive),
one for production (strict) — or control at execution time via `AgentExecution.auto_approve_all`.
