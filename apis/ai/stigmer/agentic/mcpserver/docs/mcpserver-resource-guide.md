# McpServer YAML Schema Reference

Core schema reference for the `agentic.stigmer.ai/v1` McpServer resource. For conceptual overview and lifecycle, see [README.md](README.md).

## McpServer YAML Structure

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: acme-corp
  visibility: visibility_private
  labels:
    category: vcs
  annotations:
    docs-url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github"
  tags:
    - git
    - vcs
    - code-review
spec:
  description: "GitHub MCP server for repository operations and code search"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"
  tags:
    - git
    - code
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  default_enabled_tools:
    - search_code
    - get_file_contents
    - create_pull_request
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo scope"
        is_secret: true
  default_tool_approvals:
    - tool_name: delete_repository
      message: "Delete repository: {{args.repo}}"
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `McpServer` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | McpServer configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name of the MCP server (e.g., `"GitHub MCP Server"`). |
| `metadata.slug` | No | URL-friendly identifier, unique within the organization. Auto-generated from `name` if omitted. Format: lowercase alphanumeric with hyphens, starts with a letter, 1–63 characters. This is what agents use in `mcp_server_ref.slug`. |
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
| `metadata.org` | Recommended | Organization that owns this McpServer. Set automatically from `context.organization` if omitted during apply. |
| `metadata.visibility` | No | `visibility_private` (default): only org members can access. `visibility_public`: anyone can discover and reference this server (used for marketplace publishing). Write access always requires org membership. |
| `metadata.labels` | No | Key-value pairs for filtering and organization (e.g., `category: vcs`). |
| `metadata.annotations` | No | Key-value pairs for additional metadata not used for filtering (e.g., `docs-url: "https://..."`). |
| `metadata.tags` | No | String array for categorization and search. |
| `metadata.version` | No | System-managed version tracking. Contains `id`, `message`, and `previous_version_id`. Never set directly in YAML. |

### Visibility

```yaml
# Private McpServer (default) — only your org can access it
metadata:
  name: internal-database
  org: acme-corp
  visibility: visibility_private

# Public McpServer — discoverable and referenceable by any org
metadata:
  name: github
  org: stigmer
  visibility: visibility_public
```

### Canonical Reference Format

The canonical reference for an McpServer is `org/slug`. This format appears in logs, the UI, and API responses, and is used when agents reference the server:

```yaml
# In an Agent's mcp_server_usages:
mcp_server_ref:
  org: stigmer
  kind: mcp_server
  slug: github    # matches metadata.slug of the McpServer resource
```

The `slug` is what agents use in `mcp_server_ref.slug` and in sub-agent `mcp_access.mcp_server`. Choose a slug that is short, descriptive, and stable — it forms part of the identity referenced by every agent using this server.

## Spec Fields

All spec fields are defined by `McpServerSpec` in `ai/stigmer/agentic/mcpserver/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.description` | Recommended | Human-readable explanation of what this MCP server does and its primary use cases. Shown in the marketplace and agent configuration UI. |
| `spec.icon_url` | No | Publicly accessible image URL (SVG, PNG, JPEG) for display in the marketplace and agent configuration screens. |
| `spec.tags` | No | Categorization tags for marketplace discoverability. Use lowercase, hyphenated values. Tags here are separate from `metadata.tags` — these describe the server's domain and capabilities. |
| `spec.stdio` | Conditionally required | Configuration for a subprocess-based server. Exactly one of `stdio` or `http` must be specified. See [server-types.md](server-types.md). |
| `spec.http` | Conditionally required | Configuration for an HTTP-based server. Exactly one of `stdio` or `http` must be specified. See [server-types.md](server-types.md). |
| `spec.default_enabled_tools` | No | Tools enabled from this server by default. Empty list = all tools are enabled. Agents can restrict further via `enabled_tools` in `mcp_server_usages`. Tool names must match exactly what the server reports via `tools/list`. |
| `spec.env_spec` | No | Required environment variables (schema only). Actual values are provided at runtime via the AgentInstance's environment binding. See [Environment Specification](#environment-specification). |
| `spec.default_tool_approvals` | No | Tools that require user approval by default for all agents using this server. The base layer of the approval policy chain. See [tool-approval-policies.md](tool-approval-policies.md). |

### Server Type (oneof — required)

The `server_type` field is a `oneof` with `required` validation: exactly one of `stdio` or `http` must be present. Omitting both, or specifying both, will fail validation.

```yaml
# stdio — runs a subprocess
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]

# http — connects to a remote endpoint
spec:
  http:
    url: "https://mcp.example.com/v1"
```

See [server-types.md](server-types.md) for the complete field reference and guidance on choosing between them.

### Default Enabled Tools

`default_enabled_tools` acts as the **McpServer-level tool gate** — the default set of tools that are available when an agent references this server without specifying `enabled_tools`.

```yaml
spec:
  default_enabled_tools:
    - search_code
    - get_file_contents
    - list_issues
    - create_pull_request
    # delete_repository is NOT here — too dangerous to enable by default
```

The override chain for tool availability:

| Priority | Where Set | What It Controls |
|---|---|---|
| 1 (lowest) | `McpServer.default_enabled_tools` | Default tools enabled for all agents |
| 2 | `Agent.McpServerUsage.enabled_tools` | Per-agent tool restriction (subset of McpServer defaults, or full set if McpServer default is empty) |

An empty `default_enabled_tools` means all tools are available — agents then restrict using `enabled_tools`. A non-empty list acts as a platform-level gate that agents can only further restrict, never expand.

### Environment Specification

`env_spec` declares the schema of environment variables the MCP server requires at runtime. This is documentation + validation, not actual values. Values are provided via the AgentInstance's environment binding.

```yaml
spec:
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo and read:org scopes"
        is_secret: true
      GITHUB_OWNER:
        description: "Default GitHub organization or username (e.g., acme-corp)"
        is_secret: false
```

| Field | Description |
|---|---|
| `value` | Actual value. Leave empty in the McpServer spec — values are provided at runtime. Can be pre-populated for non-secret, shared defaults. |
| `is_secret` | `true`: encrypted at rest, redacted in logs, requires special permissions to read. `false`: stored as plaintext, visible in audit logs. |
| `description` | Shown in the UI when configuring an AgentInstance. Be specific about the required format and permissions (e.g., "GitHub PAT with `repo` and `read:org` scopes"). |

The `EnvironmentSpec` and `EnvironmentValue` types are defined in `ai/stigmer/agentic/environment/v1/spec.proto` and are shared across McpServers, Agents, AgentInstances, and WorkflowInstances.

## Status Fields

Status is system-managed and must never be set by users in YAML.

| Field | Description |
|---|---|
| `status.validation_state` | Structural validity of the McpServer definition: `valid`, `invalid`, or `validation_state_unspecified` (not yet validated). |
| `status.validation_message` | Human-readable explanation of what's wrong. Populated only when `validation_state` is `invalid`. |
| `status.discovered_capabilities` | Snapshot of tools and resource templates the server reports. Populated by seedpack bootstrap or CLI discovery. See [capability-discovery.md](capability-discovery.md). |
| `status.audit` | Standard audit trail: `spec_audit` and `status_audit`, each containing `created_by`, `created_at`, `updated_by`, `updated_at`, and last `event` type. |

### Validation State

The `validation_state` field tells you whether the McpServer definition is structurally correct and safe to reference in agents.

| Value | Meaning |
|---|---|
| `validation_state_unspecified` | Validation has not yet been performed (default for new resources). |
| `valid` | All required fields are present and valid. The definition can be referenced by agents. |
| `invalid` | The definition has errors. Check `validation_message` for details. Agents referencing an invalid McpServer will fail at runtime. |

Check status after applying:
```bash
stigmer get mcp-server github --output yaml
# Look at status.validation_state and status.validation_message
```

## CLI Commands

```bash
# Apply (create or update) an McpServer from a YAML file
stigmer apply -f mcpserver.yaml

# Validate without applying
stigmer apply -f mcpserver.yaml --dry-run

# List all MCP servers
stigmer list mcp-server

# List MCP servers from a specific organization
stigmer list mcp-server --org acme-corp

# Get MCP server details (table format)
stigmer get mcp-server github

# Get MCP server details as YAML (includes status and discovered capabilities)
stigmer get mcp-server github --output yaml

# Delete an MCP server
stigmer delete mcp-server github

# Discover and cache the server's tools and resource templates
stigmer discover mcp-server github
```

See [capability-discovery.md](capability-discovery.md) for the full `stigmer discover mcp-server` workflow.

## Related Documentation

- [README.md](README.md) — Overview, lifecycle, and table of contents
- [server-types.md](server-types.md) — Stdio vs HTTP: when to use each, full field reference
- [tool-approval-policies.md](tool-approval-policies.md) — Default approval policies and message templates
- [capability-discovery.md](capability-discovery.md) — Discovered capabilities and the CLI discovery workflow
- [examples.md](examples.md) — Complete YAML examples from minimal to marketplace-ready
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist and common pitfalls
- [Agent docs: mcp-server-integration.md](../agent/docs/mcp-server-integration.md) — How agents reference and configure McpServers
