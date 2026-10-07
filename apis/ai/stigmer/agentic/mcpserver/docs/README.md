# McpServer Resource Documentation

Comprehensive documentation for the `agentic.stigmer.ai/v1` McpServer resource.

## What Is an McpServer?

An McpServer is a Kubernetes-style API resource that defines a reusable **MCP (Model Context Protocol) server configuration**. It declares how an external tool provider is started or connected to, and what environment variables it requires. Its tools are discovered when it connects, each with the server's own destructive annotation, which decides whether Stigmer asks before the tool runs.

McpServers are first-class platform resources — they live independently of any agent and can be referenced by many agents simultaneously. This is the key distinction from an inline server definition: an McpServer can be governed, versioned, published to the marketplace, and shared across an organization.

## McpServer in the Platform Lifecycle

```
McpServer ──► Referenced by Agent or Session ──► Keys resolved per run ──► Started by Agent Runner
```

| Resource | Role |
|---|---|
| **McpServer** | Declares server type, connection details and required env vars. The reusable template. |
| **Agent** | References one or more McpServers via `mcp_server_usages`. Optionally narrows their tools with its `tools` and `disallowed_tools` lists. |
| **Run** | Resolves the keys each referenced McpServer declares when it starts: from the Environments bound to the schedule or PlatformClient that started it, from `runtime_env`, then OAuth tokens and the personal environment of the person who sent the message for keys still missing. |
| **Agent Runner** | Resolves each McpServer reference at run time, passes each server the keys it declares, and starts or connects to the server process. |

The McpServer resource itself contains **no secrets** — only the schema of what credentials are needed (`env_spec`). Actual values are supplied when each run starts, from the sources above. This makes McpServer definitions safe to store in version control and to carry in a plugin.

## Visibility and Ownership

McpServers take one of three visibility levels:

- `visibility_org` (default) — every member of the owning organization can read and use the server.
- `visibility_private` — the creator and anyone granted access directly.
- `visibility_child_orgs` — everyone in the owning organization's child organizations. Offered only to an organization that is not itself a child.

Nothing is readable outside the organization otherwise. A server another organization built (e.g. the `github` server from Stigmer's catalogue) reaches yours as a plugin you install; the installed copy is your organization's own.

Every McpServer belongs to exactly one organization. The `org` field in metadata identifies the owning organization. The canonical reference format is `org/slug` (e.g., `stigmer/github`, `acme-corp/internal-db`).

## Documentation Index

| Document | Description |
|---|---|
| [mcpserver-resource-guide.md](mcpserver-resource-guide.md) | Full YAML schema reference — metadata, spec fields, status fields, CLI commands |
| [server-types.md](server-types.md) | Stdio vs HTTP transport — when to use each, configuration fields, env var interpolation |
| [capability-discovery.md](capability-discovery.md) | How tool capabilities are discovered — the connect flow's entry points, `DiscoveredCapabilities`, and which tools ask for approval |
| [examples.md](examples.md) | Complete YAML examples from minimal to full-featured marketplace server |
| [validation-checklist.md](validation-checklist.md) | Pre-apply checklist and common pitfalls |

## How Agents Reference McpServers

Agents reference McpServer resources via `spec.mcp_server_usages`. See the Agent documentation for the reference format and how an agent narrows a server's tools with its tool lists:

- [Agent docs: mcp-server-integration.md](../../agent/docs/mcp-server-integration.md)
- [Agent docs: resource-references.md](../../agent/docs/resource-references.md)
