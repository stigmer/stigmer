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
  hooks: []
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
| `metadata.org` | Recommended | Organization that owns this agent. Set automatically from `context.org` if omitted during apply. Format: lowercase alphanumeric with hyphens (e.g., `acme-corp`). |
| `metadata.visibility` | No | Access control. `visibility_org` (default): every member of the owning organization can read. `visibility_private`: the creator and anyone granted access directly. `visibility_platform`: every organization the owning organization manages through its identity provider. Nothing is readable outside the organization otherwise; another organization's agent reaches yours as a plugin you install. |
| `metadata.labels` | No | Key-value pairs for organization and filtering (e.g., `team: engineering`). |
| `metadata.annotations` | No | Key-value pairs for additional metadata not used for filtering (e.g., `docs-url: "https://..."`). |
| `metadata.tags` | No | String array for categorization and search (e.g., `["code-review", "security"]`). |
| `metadata.version` | No | System-managed version tracking. Contains `id`, `message`, and `previous_version_id` for audit trail. Never set directly in YAML. |

### Visibility

Agents take one of three levels. Organization is the default: a blueprint is a shared asset of the organization that owns it. Private is an explicit opt-in. Platform is offered only to an organization that operates an identity provider, and shares the agent with every organization it manages. An agent may not be more visible than the skills, MCP servers and agents it references; the server refuses the save (and the escalation) that would break that.

```yaml
# Organization agent (default) — every member of acme-corp can read and run it
metadata:
  name: internal-reviewer
  org: acme-corp
  visibility: visibility_org

# Private agent — the creator and anyone granted access directly
metadata:
  name: my-draft
  org: acme-corp
  visibility: visibility_private

# Platform agent — every organization acme-cloud manages through its identity provider
metadata:
  name: onboarding-assistant
  org: acme-cloud
  visibility: visibility_platform
```

### Organization

The `org` field determines ownership. Every agent belongs to exactly one organization. The CLI resolves the organization through a priority chain: `--org` flag > `stigmer.yaml` `metadata.org` > `context.org` in config > error. On first server start, a `default` organization is bootstrapped automatically.

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
| `spec.tools` | No | Tools this agent may use, in Claude Code's names (`Read`, `Bash(git push *)`, `mcp__<server-slug>`). Empty means every tool it has. See [mcp-server-integration.md](mcp-server-integration.md). |
| `spec.disallowed_tools` | No | Tools this agent may never use, in the same names. Applied before `spec.tools`. |
| `spec.hooks` | No | Hooks that run around this agent's tool calls and its sub-agents' calls: a plugin whose hooks apply, or a hooks block written in the agent. See [Hooks](#hooks). |
| `spec.env_spec` | No | Required environment variables (schema only). See below. |

## Hooks

`spec.hooks` lists where the agent's hooks come from. A hook is a command that runs before or after a tool call, in Claude Code's hooks format: before a call (`PreToolUse`) it can refuse it, ask a person first, or let it run without the approval it would otherwise need; after a call succeeds (`PostToolUse`) it can add to what the agent reads. A hook that answers nothing leaves the call to the default (see the AgentExecution resource's `hitl-approvals.md`).

Each entry is one of two sources. A plugin reference applies the hooks that plugin recorded at install:

```yaml
spec:
  hooks:
    - plugin:
        kind: plugin
        slug: safety
```

A block written in the agent takes the shape of Claude Code's `hooks.json`, one group per event with an optional matcher and its handlers:

```yaml
spec:
  hooks:
    - inline:
        groups:
          - event: PreToolUse
            matcher: Bash
            handlers:
              - command: "./scripts/check-push.sh"
                condition: "Bash(git push *)"
                timeout_seconds: 30
```

`condition` is Claude Code's `if`: a permission rule that narrows when the handler runs. A handler runs in `bash`, or without a shell when it has `args`; it reads the call as JSON on stdin and answers as a Claude Code hook does (exit code 2 refuses with stderr as the reason; JSON on stdout can allow, ask or deny).

A script in the workspace, as above, is a convenience and not a boundary: the agent can edit its workspace, the script included. For a policy the agent must not be able to change, use a plugin: its hooks run from the plugin's installed files (`${CLAUDE_PLUGIN_ROOT}`), which the runner restores to the installed version before every hook run.

Hooks are the agent author's policy. Whoever runs the agent runs its hooks, and a hook that lets a call run skips the approval the default would have asked of that person, as a hook that asks adds one. An agent shared with others carries its hooks to them, as it carries its tools and instructions.

What holds:

- The native engine runs Claude Code-format hooks, in the Cloud and on a laptop. The Cursor engine refuses a turn whose agent has hooks, and a plugin whose hooks are in Cursor's format is not run yet.
- Apply checks an inline block: events must be `PreToolUse` or `PostToolUse`, and every matcher and condition must have the shape Claude Code accepts. It fills an omitted format with Claude Code's, so a block never names one. Apply also refuses two plugin references with the same slug and more than one inline block.
- Installing a plugin whose hooks are in Claude Code's format adds the plugin's own reference to the agent the install composes, and declares in its `env` every variable those hooks read.
- A plugin reference with no `version` follows the plugin's installed version. A hook that reads a variable the run does not have refuses the turn, naming the variable.

## Environment Specification

Agents can declare required environment variables via `env_spec`. This defines the **schema** — actual values are provided at runtime: from the Environments bound to the schedule, workflow task or PlatformClient that started the run, from the execution's `runtime_env`, and, for keys still missing, from the personal environment of the person who sent the message. Those keys reach the agent's tools and shell; the console names the keys an agent will read from a person's personal environment before their first message.

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
| `value` | The actual value. Typically left empty in the Agent spec — values are provided at runtime from the sources above. Can be pre-populated for non-secret defaults. |
| `is_secret` | `true`: encrypted at rest, redacted in logs, requires special permissions to read. `false`: stored as plaintext, visible in audit logs. |
| `description` | Documentation for the variable. Shown in the UI when a person supplies the value. |

The shared `EnvironmentSpec` and `EnvironmentValue` types are defined in `ai/stigmer/agentic/environment/v1/spec.proto` and reused across Agents, McpServers, and WorkflowInstances.

## Status Fields

Status is system-managed and must never be set by users in YAML.

| Field | Description |
|---|---|
| `status.version_hash` | Content hash of the agent's current version. A session that names the agent pins the version its reference resolved to; see the Session's `status.agent_version_hash`. |
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
- [mcp-server-integration.md](mcp-server-integration.md) — MCP server usage, the two tool lists and which tools ask for approval
- [skill-integration.md](skill-integration.md) — Skill integration and injection
- [sub-agents.md](sub-agents.md) — Sub-agent delegation and permission model
- [examples.md](examples.md) — Complete YAML examples from minimal to full-featured
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist and common pitfalls
