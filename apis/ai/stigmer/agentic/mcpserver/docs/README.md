# McpServer Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` McpServer resource.

## What Is an McpServer?

An McpServer is a Kubernetes-style API resource that defines a reusable **MCP (Model Context Protocol) server configuration**. It declares how an external tool provider is started or connected to, what environment variables it requires, which tools it exposes by default, and what approval policies govern those tools.

McpServers are first-class platform resources — they live independently of any agent and can be referenced by many agents simultaneously. This is the key distinction from an inline server definition: an McpServer can be governed, versioned, published to the marketplace, and shared across an organization.

## McpServer in the Platform Lifecycle

```
McpServer ──► Referenced by Agent ──► Resolved by AgentInstance ──► Started by Agent Runner
```

| Resource | Role |
|---|---|
| **McpServer** | Declares server type, connection details, required env vars, and default approval policies. The reusable template. |
| **Agent** | References one or more McpServers via `mcp_server_usages`. Optionally restricts tools and overrides approval policies per agent. |
| **AgentInstance** | Binds an Agent to an Environment — provides the actual credentials and secrets required by each referenced McpServer. |
| **Agent Runner** | Resolves each McpServer reference at execution time, retrieves secrets from the Environment, and starts or connects to the server process. |

The McpServer resource itself contains **no secrets** — only the schema of what credentials are needed (`env_spec`). Actual values are supplied at runtime through the AgentInstance's environment binding. This makes McpServer definitions safe to store in version control and share publicly.

## Visibility and Ownership

McpServers support two visibility levels:

- `visibility_private` (default) — only members of the owning organization can access the resource.
- `visibility_public` — discoverable and usable by anyone on the platform. Used for publishing to the marketplace (e.g., `stigmer/github`, `stigmer/web-search`).

Every McpServer belongs to exactly one organization. The `org` field in metadata identifies the owning organization. The canonical reference format is `org/slug` (e.g., `stigmer/github`, `acme-corp/internal-db`).

## Documentation Index

| Document | Description |
|---|---|
| [mcpserver-resource-guide.md](mcpserver-resource-guide.md) | Full YAML schema reference — metadata, spec fields, status fields, CLI commands |
| [server-types.md](server-types.md) | Stdio vs HTTP transport — when to use each, configuration fields, env var interpolation |
| [tool-approval-policies.md](tool-approval-policies.md) | `default_tool_approvals`, `ToolApprovalPolicy`, message templates, and the full policy chain |
| [capability-discovery.md](capability-discovery.md) | How tool capabilities are discovered — seedpack, CLI discovery workflow, `DiscoveredCapabilities` |
| [examples.md](examples.md) | Complete YAML examples from minimal to full-featured marketplace server |
| [validation-checklist.md](validation-checklist.md) | Pre-apply checklist and common pitfalls |

## How Agents Reference McpServers

Agents reference McpServer resources via `spec.mcp_server_usages`. See the Agent documentation for the reference format and how agents layer their own tool restrictions and approval overrides on top of the McpServer defaults:

- [Agent docs: mcp-server-integration.md](../agent/docs/mcp-server-integration.md)
- [Agent docs: resource-references.md](../agent/docs/resource-references.md)
