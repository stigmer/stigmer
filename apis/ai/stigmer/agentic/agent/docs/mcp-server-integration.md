# MCP Server Integration

How Agents declare and use MCP servers, including tool selection, approval overrides, and runtime resolution.

## What Are MCP Servers?

MCP (Model Context Protocol) servers provide external tools and capabilities to AI agents through a standardized protocol. They enable agents to interact with external systems (GitHub, Slack, databases), access local resources, and execute custom operations.

MCP servers are first-class platform resources (`kind: mcp_server`, enum value 44). They are created and managed independently, then referenced by agents. See [resource-references.md](resource-references.md) for the reference format.

## How Agents Reference MCP Servers

Agents declare MCP server usage via `spec.mcp_server_usages`. Each entry references a McpServer resource and optionally restricts which tools are available and customizes approval policies.

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
      tool_approval_overrides:
        - tool_name: delete_repository
          requires_approval: true
          message: "Delete repository: {{args.repo_name}}"
```

## McpServerUsage Fields

Defined by `McpServerUsage` in `ai/stigmer/agentic/agent/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `mcp_server_ref` | Yes | Reference to a McpServer resource. Must have `kind: mcp_server`. See [resource-references.md](resource-references.md). |
| `enabled_tools` | No | Tools to enable from this MCP server. Empty list = use the McpServer's `default_enabled_tools` (or all tools if not set). Tool names must match exactly what the MCP server reports via `tools/list`. |
| `tool_approval_overrides` | No | Per-agent approval policy customization (see below). |

The `mcp_server_ref.slug` from each entry must be **unique** within a single agent's `mcp_server_usages`. You cannot reference the same MCP server twice.

The slug from `mcp_server_ref` is also how sub-agents identify which MCP server to access — see [sub-agents.md](sub-agents.md).

## Tool Approval Overrides

Agents can customize which tools require user approval before execution. This is the per-agent layer of the approval policy chain.

```yaml
tool_approval_overrides:
  - tool_name: send_email
    requires_approval: true
    message: "Send email to {{args.recipient}}"
  - tool_name: delete_repository
    requires_approval: false
```

### Fields

Defined by `ToolApprovalOverride` in `ai/stigmer/agentic/agent/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `tool_name` | Yes | Must match the MCP server's tool name exactly (case-sensitive). Minimum 1 character. |
| `requires_approval` | Yes | `true`: requires approval (even if the McpServer default doesn't). `false`: no approval needed (overrides any McpServer default). |
| `message` | No | Approval prompt shown to users. Supports `{{args.field}}` template placeholders. See [Message Inheritance](#message-inheritance). |

### Message Inheritance

When `requires_approval` is `true` and `message` is empty, the system resolves the approval message using this fallback chain:

1. If the McpServer has a `default_tool_approvals` entry for this tool with a message, that message is used.
2. Otherwise, the system auto-generates: `"Execute tool: {tool_name}"`.

When `message` is provided, it **overrides** any McpServer default message for this tool.

Guidelines for effective approval messages:
- Be specific to this agent's context
- Include the most important argument values via `{{args.field}}` placeholders
- Keep under 100 characters for clean UI display

### Silent Failure for Invalid Tool Names

If a `tool_name` in `tool_approval_overrides` does not match any tool in the referenced McpServer's `tools/list`, the override is **silently ignored** — no error, no approval applied.

This is intentional for forward-compatibility: MCP servers can add or remove tools without breaking existing agent configurations. However, it means a **typo in `tool_name` will silently disable the approval policy** for that tool. There is no runtime warning.

Verify tool names by querying the MCP server before writing overrides:
```bash
stigmer mcp-server get github --output yaml
```

## Tool Approval Policy Chain

Approval policies are resolved in order of increasing priority:

| Priority | Source | Description |
|---|---|---|
| 1 (lowest) | `McpServer.default_tool_approvals` | Platform/org defaults set on the MCP server resource |
| 2 | `Agent.McpServerUsage.tool_approval_overrides` | Per-agent customization (this document) |
| 3 (highest) | `AgentExecution.auto_approve_all` | Runtime bypass — when set to `true` on an AgentExecution, all tools run without approval regardless of other policies |

Each layer can override the one below it. An agent can make a tool require approval even if the McpServer default says it doesn't, and a specific execution can bypass all approvals entirely.

`AgentExecution.auto_approve_all` is a field on the `AgentExecutionSpec` resource. It is set at execution time (not in the Agent YAML) and is typically used for trusted automation pipelines where human-in-the-loop approval is not needed.

## Runtime Resolution Flow

At runtime, the Agent does not connect to MCP servers directly. The flow is:

1. **Agent** declares `mcp_server_usages` (references only — no connections, no secrets)
2. **AgentInstance** binds the Agent to an Environment (provides secrets/credentials needed by the MCP servers)
3. **Agent Runner** resolves each McpServer reference, retrieves secrets from the Environment, and starts the actual MCP server process
4. The running MCP server's tools become available to the agent during the AgentExecution

This separation means the Agent YAML is portable and contains no secrets. Different AgentInstances can bind the same Agent to different environments (e.g., staging vs production credentials).
