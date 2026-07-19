# Tool Approval Policies

How McpServers define default approval requirements for tools, how message templates work, and how the full three-layer policy chain resolves at runtime.

## What Are Tool Approval Policies?

Before an agent executes a tool call, the platform checks whether that tool requires user approval (human-in-the-loop). Approval policies exist at multiple layers so that:

- The **McpServer owner** can establish organization-wide defaults for dangerous operations.
- Each **Agent** can customize those defaults for its specific use case.
- Individual **executions** can bypass all approvals for trusted automation pipelines.

McpServer's `default_tool_approvals` is the **base layer** — the defaults applied to every agent that references this server.

## Defining Default Tool Approvals

```yaml
spec:
  default_tool_approvals:
    - tool_name: delete_repository
      message: "Delete repository: {{args.repo}}"
    - tool_name: force_push
      message: "Force push to {{args.branch}} on {{args.repo}}"
    - tool_name: add_collaborator
      message: "Add {{args.username}} as collaborator to {{args.repo}}"
    - tool_name: send_email
      message: "Send email to {{args.recipient}}: {{args.subject}}"
```

Tools not listed in `default_tool_approvals` do not require approval by default. Agents can still add approval requirements via `tool_approval_overrides`.

## ToolApprovalPolicy Fields

Defined by `ToolApprovalPolicy` in `ai/stigmer/agentic/mcpserver/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `tool_name` | Yes | Name of the tool as reported by the MCP server's `tools/list`. Case-sensitive. Minimum 1 character. Must match exactly — see [Silent Failure on Typos](#silent-failure-on-typos). |
| `message` | No | Approval prompt shown to the user. Supports `{{args.field}}` and `{{tool_name}}` placeholders. If empty, the system generates a default: `"Execute tool: {tool_name}"`. |

## Message Templates

The `message` field supports two placeholder types resolved at runtime:

| Placeholder | Source | Behavior |
|---|---|---|
| `{{args.field_name}}` | Tool call arguments | Replaced with the argument value. If the argument is missing, replaced with `<unknown>`. |
| `{{tool_name}}` | Tool name | Always available — replaced with the tool's name. |

### Examples

**Contextual message with argument value:**
```yaml
tool_name: delete_repository
message: "Delete repository: {{args.repo}}"
# At runtime: "Delete repository: acme-corp/webapp"
```

**Multiple arguments:**
```yaml
tool_name: delete_file
message: "Delete {{args.path}} from {{args.repository}}"
# At runtime: "Delete src/main.py from acme/webapp"
```

**Missing argument fallback:**
```yaml
tool_name: send_notification
message: "Send notification to {{args.channel}}"
# If args.channel is not present: "Send notification to <unknown>"
```

**Empty message — auto-generated default:**
```yaml
tool_name: dangerous_operation
message: ""
# At runtime: "Execute tool: dangerous_operation"
```

### Writing Effective Approval Messages

Approval messages are the only context a user has when deciding whether to approve a tool call. Write them to enable informed decisions:

- **Be specific.** "Delete repository: {{args.repo}}" is more useful than "Perform delete operation."
- **Include the highest-risk arguments.** Show the values that determine the impact of the action.
- **Use action verbs.** "Delete", "Send", "Execute", "Create", "Drop" — not passive voice.
- **Stay under 100 characters.** Longer messages are truncated in the UI.

```yaml
# Good — specific, shows what will be affected
message: "Drop table {{args.table_name}} from {{args.database}}"

# Poor — vague, no context for the user
message: "Executing database operation"
```

## The Three-Layer Policy Chain

Approval policies are resolved in order of increasing priority. Each layer overrides the one below it.

```
McpServer.default_tool_approvals
        │
        ▼ (can override per-agent)
Agent.McpServerUsage.tool_approval_overrides
        │
        ▼ (can bypass entirely at runtime)
AgentExecution.auto_approve_all
```

| Priority | Source | Scope | Description |
|---|---|---|---|
| 1 (lowest) | `McpServer.default_tool_approvals` | All agents using this server | Platform/org defaults for dangerous operations. Established by the McpServer owner. |
| 2 | `Agent.McpServerUsage.tool_approval_overrides` | Single agent | Per-agent customization. An agent can add approval requirements for tools that the McpServer doesn't require approval for, or remove them for tools the McpServer marks as requiring approval. |
| 3 (highest) | `AgentExecution.auto_approve_all` | Single execution | Runtime bypass. When `true`, all tools in that execution run without approval regardless of any policy. Used for trusted automation pipelines. |

### Layer 1 — McpServer Defaults (this document)

Set in `McpServer.spec.default_tool_approvals`. Applied to every agent referencing this server. Cannot be removed by agents — agents can only choose `requires_approval: false` to disable a default on their specific usage.

```yaml
# In McpServer spec — applies to all agents
spec:
  default_tool_approvals:
    - tool_name: drop_table
      message: "Drop table: {{args.table}}"
```

### Layer 2 — Per-Agent Overrides

Set in `Agent.spec.mcp_server_usages[*].tool_approval_overrides`. Each entry either adds a new approval requirement or explicitly overrides the McpServer default:

```yaml
# In Agent spec — overrides for this specific agent
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: database
      tool_approval_overrides:
        # Remove approval for drop_table (McpServer has it on, agent trusts this context)
        - tool_name: drop_table
          requires_approval: false
        # Add approval for execute_sql (McpServer doesn't require it, but this agent should)
        - tool_name: execute_sql
          requires_approval: true
          message: "Execute SQL: {{args.query}}"
```

See [Agent docs: mcp-server-integration.md](../agent/docs/mcp-server-integration.md) for full documentation on `tool_approval_overrides`.

### Layer 3 — Execution-Level Bypass

Set on `AgentExecution.spec.auto_approve_all`. When `true`, all tools in that execution run without any approval prompt, regardless of McpServer defaults and Agent overrides. This is set at execution time — not in the McpServer or Agent YAML — and is intended for trusted automation pipelines where human-in-the-loop is unnecessary.

### Orthogonal: Unattended Approval Mode (Resolution, Not Gating)

`ExecutionConfig.approval_mode = APPROVAL_MODE_UNATTENDED` does NOT change which tools the chain gates — it changes what happens when a gate fires. On surfaces with no approver (messaging channels, guest shares), a gated tool is auto-**skipped** (it does not run) and the model adapts, instead of pausing the execution for a decision that can never arrive. Contrast with `auto_approve_all`, which clears gates so tools **run**. The mode is stamped by the platform surface that creates the execution, never by the external user. For channel/guest agents, the operator lever remains this chain: un-gate a specific tool per agent (layer 2, `requires_approval: false`) once the agent's instructions confirm intent conversationally. See [AgentExecution docs: hitl-approvals.md](../../agentexecution/docs/hitl-approvals.md#unattended-surfaces-channels-and-guest-shares).

## Silent Failure on Typos

If a `tool_name` in `default_tool_approvals` does not match a tool reported by the server's `tools/list`, the policy is **silently ignored** — no error, no warning. The approval is simply not applied.

This is intentional for forward-compatibility: MCP servers can add or remove tools without breaking existing configurations. However, a typo in `tool_name` will silently disable the approval policy for that tool.

```yaml
# Dangerous — typo means no approval is enforced
default_tool_approvals:
  - tool_name: delet_repository  # typo: missing 'e'
    message: "Delete repository: {{args.repo}}"

# Correct
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete repository: {{args.repo}}"
```

Always verify tool names against the server before writing approval policies:
```bash
stigmer discover mcp-server github
stigmer get mcp-server github --output yaml
# Check status.discovered_capabilities.tools[*].name
```

See [capability-discovery.md](capability-discovery.md) for the full discovery workflow.

## Related Documentation

- [mcpserver-resource-guide.md](mcpserver-resource-guide.md) — Full schema reference including `spec.default_tool_approvals`
- [capability-discovery.md](capability-discovery.md) — How to discover exact tool names before writing policies
- [Agent docs: mcp-server-integration.md](../agent/docs/mcp-server-integration.md) — Layer 2: per-agent `tool_approval_overrides`
- [examples.md](examples.md) — Complete YAML examples with approval policies
- [validation-checklist.md](validation-checklist.md) — Common pitfalls including tool name typos
