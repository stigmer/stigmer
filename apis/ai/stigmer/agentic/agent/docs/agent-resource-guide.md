# Agent YAML Schema Reference

Core schema reference for the `agentic.stigmer.ai/v1` Agent resource. For conceptual overview and lifecycle, see [README.md](README.md).

## Agent YAML Structure

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: my-agent
  org: acme-corp
  visibility: visibility_private
  labels:
    team: engineering
  annotations:
    docs-url: "https://internal.example.com/agents/my-agent"
  tags:
    - code-review
    - security
spec:
  description: "Human-readable description of the agent"
  icon_url: "https://example.com/icon.svg"
  instructions: |
    You are an agent that...
  mcp_server_usages: []
  skill_refs: []
  sub_agents: []
  env_spec: {}
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `Agent` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | Agent configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name of the agent. |
| `metadata.slug` | No | URL-friendly identifier, unique within the organization. Auto-generated from `name` if omitted. Format: lowercase alphanumeric with hyphens, starts with a letter, 1-63 characters. |
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
| `metadata.org` | Recommended | Organization that owns this agent. Set automatically from `context.organization` if omitted during apply. Format: lowercase alphanumeric with hyphens (e.g., `acme-corp`). |
| `metadata.visibility` | No | Access control. `visibility_private` (default): only org members can access. `visibility_public`: anyone can read (write still requires org membership). Used for marketplace-published agents. |
| `metadata.labels` | No | Key-value pairs for organization and filtering (e.g., `team: engineering`). |
| `metadata.annotations` | No | Key-value pairs for additional metadata not used for filtering (e.g., `docs-url: "https://..."`). |
| `metadata.tags` | No | String array for categorization and search (e.g., `["code-review", "security"]`). |
| `metadata.version` | No | System-managed version tracking. Contains `id`, `message`, and `previous_version_id` for audit trail. Never set directly in YAML. |

### Visibility

Agents support public visibility. This is how agents are published to the marketplace.

```yaml
# Private agent (default) — only your org can see it
metadata:
  name: internal-reviewer
  org: acme-corp
  visibility: visibility_private

# Public agent — visible to everyone, writable only by org members
metadata:
  name: web-search
  org: stigmer
  visibility: visibility_public
```

### Organization

The `org` field determines ownership. Every agent belongs to exactly one organization. The CLI resolves the organization through a priority chain: `--org` flag > `stigmer.yaml` `metadata.org` > `context.organization` in config > error. On first server start, a `default` organization is bootstrapped automatically.

## Spec Fields

All spec fields are defined by `AgentSpec` in `ai/stigmer/agentic/agent/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.description` | Recommended | 1-2 sentence summary for UI and marketplace display. No proto-level validation enforces presence, but agents without descriptions render poorly in the UI and marketplace. |
| `spec.icon_url` | No | Publicly accessible image URL (SVG, PNG, JPEG) for marketplace and UI. |
| `spec.instructions` | Yes | System prompt defining the agent's behavior. Minimum 10 characters (enforced by `buf.validate`). |
| `spec.mcp_server_usages` | No | MCP servers this agent can use. See [mcp-server-integration.md](mcp-server-integration.md). |
| `spec.skill_refs` | No | Skills providing agent knowledge. See [skill-integration.md](skill-integration.md). |
| `spec.sub_agents` | No | Specialized sub-agents for delegation. See [sub-agents.md](sub-agents.md). |
| `spec.env_spec` | No | Required environment variables (schema only). See below. |

## Environment Specification

Agents can declare required environment variables via `env_spec`. This defines the **schema** — actual values are provided at runtime via the AgentInstance's environment binding.

```yaml
spec:
  env_spec:
    data:
      API_URL:
        description: "Base URL for the target API"
        is_secret: false
      AUTH_TOKEN:
        description: "API authentication token"
        is_secret: true
```

The `data` field is a map of variable name to `EnvironmentValue`:

| Field | Description |
|---|---|
| `value` | The actual value. Typically left empty in the Agent spec — values are provided at runtime when creating an AgentInstance. Can be pre-populated for non-secret defaults. |
| `is_secret` | `true`: encrypted at rest, redacted in logs, requires special permissions to read. `false`: stored as plaintext, visible in audit logs. |
| `description` | Documentation for the variable. Shown in the UI when configuring an AgentInstance. |

The shared `EnvironmentSpec` and `EnvironmentValue` types are defined in `ai/stigmer/agentic/environment/v1/spec.proto` and reused across Agents, AgentInstances, and WorkflowInstances.

## Status Fields

Status is system-managed and must never be set by users in YAML.

| Field | Description |
|---|---|
| `status.default_instance_id` | ID of the default AgentInstance created automatically for this agent. Every agent has exactly one default instance that requires no configuration. |
| `status.audit` | Standard audit information: `spec_audit` and `status_audit`, each containing `created_by`, `created_at`, `updated_by`, `updated_at`, and last `event` type. |

## CLI Commands

```bash
# Apply (create or update) an agent from a YAML file
stigmer apply -f agent.yaml

# Validate without applying
stigmer apply -f agent.yaml --dry-run

# List all agents
stigmer list agents

# List agents from a specific organization
stigmer list agents --org acme-corp

# Search for agents by text
stigmer search agents "code review"

# Get agent details (table format)
stigmer get agent my-agent

# Get agent details as YAML
stigmer get agent my-agent --output yaml

# Delete an agent
stigmer delete agent my-agent
```

## Related Documentation

- [README.md](README.md) — Overview, lifecycle, and table of contents
- [resource-references.md](resource-references.md) — `ApiResourceReference` format for referencing MCP servers and skills
- [mcp-server-integration.md](mcp-server-integration.md) — MCP server usage and tool approval overrides
- [skill-integration.md](skill-integration.md) — Skill integration and injection
- [sub-agents.md](sub-agents.md) — Sub-agent delegation and permission model
- [examples.md](examples.md) — Complete YAML examples from minimal to full-featured
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist and common pitfalls
