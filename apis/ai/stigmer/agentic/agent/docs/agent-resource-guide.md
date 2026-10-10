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
  plugins: []
  skill_refs: []
  sub_agents: []
  hooks: []
  env_spec: {}
  harness: HARNESS_NATIVE
  run_config: {}
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
| `metadata.name` | Yes | Human-readable name of the agent, at most 200 characters. |
| `metadata.slug` | No | URL-friendly identifier, unique within the organization. Auto-generated from `name` if omitted. Format: lowercase alphanumeric with hyphens, starts with a letter, ends with a letter or digit, 2 to 63 characters. A `name` whose derived slug breaks these rules (too long, starting with a digit, or with no ASCII letter or digit) is refused on create and apply, and on an update without `metadata.id`; set `metadata.slug`. An update by `metadata.id` keeps the stored slug, so a rename there is not checked. |
| `metadata.id` | No | System-generated unique identifier. Never set by users. |
| `metadata.org` | Recommended | Organization that owns this agent. Set automatically from `context.org` if omitted during apply. Format: lowercase alphanumeric with hyphens (e.g., `acme-corp`). |
| `metadata.visibility` | No | Access control. `visibility_org` (default): every member of the owning organization can read. `visibility_private`: the creator and anyone granted access directly. `visibility_child_orgs`: everyone in the owning organization's child organizations. Nothing is readable outside the organization otherwise; another organization's agent reaches yours as a plugin you install. |
| `metadata.labels` | No | Key-value pairs for organization and filtering (e.g., `team: engineering`). |
| `metadata.annotations` | No | Key-value pairs for additional metadata not used for filtering (e.g., `docs-url: "https://..."`). |
| `metadata.tags` | No | String array for categorization and search (e.g., `["code-review", "security"]`). |
| `metadata.version` | No | System-managed version tracking. Contains `id`, `message`, and `previous_version_id` for audit trail. Never set directly in YAML. |

### Visibility

Agents take one of three levels. Organization is the default: a blueprint is a shared asset of the organization that owns it. Private is an explicit opt-in. Platform is offered only to an organization that operates an identity provider, and shares the agent with every organization it manages. An agent may not be more visible than the skills, plugins and agents it references; the server refuses the save (and the escalation) that would break that.

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

# Shared agent — everyone in acme-cloud's child organizations
metadata:
  name: onboarding-assistant
  org: acme-cloud
  visibility: visibility_child_orgs
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
| `spec.plugins` | No | Plugins this agent uses, each whole: their skills, agents, hooks and MCP servers. See [plugin-integration.md](plugin-integration.md). |
| `spec.skill_refs` | No | Skills providing agent knowledge. See [skill-integration.md](skill-integration.md). |
| `spec.sub_agents` | No | Specialized sub-agents for delegation. See [sub-agents.md](sub-agents.md). |
| `spec.tools` | No | Tools this agent may use, in Claude Code's names (`Read`, `Bash(git push *)`, `mcp__plugin_<plugin>_<server>`). Empty means every tool it has. See [plugin-integration.md](plugin-integration.md). |
| `spec.disallowed_tools` | No | Tools this agent may never use, in the same names. Applied before `spec.tools`. |
| `spec.hooks` | No | A hooks block written in the agent, run around its tool calls and its sub-agents' calls after the hooks of the plugins it lists. See [Hooks](#hooks). |
| `spec.env_spec` | No | Required environment variables (schema only). See below. |
| `spec.harness` | No | The engine (`HARNESS_NATIVE` or `HARNESS_CURSOR`) the run defaults were chosen for, and the engine a new conversation on this agent starts on when nobody names an engine or a model (a turn naming a model but no engine starts on native). Unspecified: native. See [Run Defaults](#run-defaults). |
| `spec.run_config` | No | The author's run defaults: model, speed tier, thinking and run limits. Versioned with the agent. See [Run Defaults](#run-defaults). |

## Hooks

An agent's hooks come from two places: the plugins it lists in `spec.plugins`, each of which brings the hooks it recorded at install, and a block written in the agent under `spec.hooks`. A hook is a command that runs before or after a tool call, in Claude Code's hooks format: before a call (`PreToolUse`) it can refuse it, ask a person first, or let it run without the approval it would otherwise need; after a call succeeds (`PostToolUse`) it can add to what the agent reads. A hook that answers nothing leaves the call to the default (see the Run resource's `hitl-approvals.md`).

A plugin's hooks need nothing beyond listing the plugin:

```yaml
spec:
  plugins:
    - kind: plugin
      slug: safety
```

A block written in the agent takes the shape of Claude Code's `hooks.json`, one group per event with an optional matcher and its handlers. The plugins' hooks run first:

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

`condition` is Claude Code's `if`: a permission rule that narrows when the handler runs. Where the runner cannot be sure a condition matches (a command built from a variable or a substitution, behind a wrapper such as `timeout`, or named by path), the handler still runs and its refusal or ask counts, but its allow does not: the call falls to the default approval. A handler runs in `bash`, or without a shell when it has `args`; it reads the call as JSON on stdin and answers as a Claude Code hook does (exit code 2 refuses with stderr as the reason; JSON on stdout can allow, ask or deny). A decision that gives no reason takes the hook's `systemMessage` as its reason, and here that reason reaches the model as well as the person; a `systemMessage` with no decision, a warning, is not shown yet.

A script in the workspace, as above, is a convenience and not a boundary: the agent can edit its workspace, the script included. A plugin's hooks run from the plugin's installed files (`${CLAUDE_PLUGIN_ROOT}`), which the runner checks and restores to the installed version before every hook run, so an edit the agent makes there does not last. That is not a sandbox: the agent's shell runs as the same user, so it can still change what a hook calls (an interpreter on `PATH`, files in `${CLAUDE_PLUGIN_DATA}`, which the runner does not restore) or write the plugin's files while a hook starts. The hook's own script decides; a policy that must hold against the agent belongs in the sandbox around it. A hook must not write into `${CLAUDE_PLUGIN_ROOT}` itself: the runner restores the tree before the next hook run, even while another of the plugin's hooks runs from it. `${CLAUDE_PLUGIN_DATA}` is the plugin's place to write.

Hooks are the agent author's policy. Whoever runs the agent runs its hooks, and a hook that lets a call run skips the approval the default would have asked of that person, as a hook that asks adds one. An agent shared with others carries its hooks to them, as it carries its tools and instructions.

A hook is also code the agent's author chose, and it runs without asking anyone: in the workspace of whoever runs the agent, on every tool call it matches, with that person's run values (the variables the agent declares, their personal keys among them, and the workspace's git token), as an agent's local MCP servers do. Run a shared agent only when you trust its hooks.

What holds:

- Both engines, native and Cursor, run hooks in Claude Code's format and in Cursor's, in the Cloud and on a laptop. A Cursor-format `ask` waits for a person on both engines, where Cursor itself lets the call run.
- On the Cursor engine a hook sees no sub-agent identity (`agent_id`, `agent_type`), web fetch and web search reach no hook (an agent whose `PreToolUse` hooks would match them runs there without them; the sub-agent tool is hidden only when a matcher names it, since a sub-agent's own calls reach every hook), and a hook's rewrite applies only where Cursor applies one (a shell command, its directory or timeout, a file path, a search pattern, a URL); a rewrite of a file's content or of an MCP tool's arguments is refused with a sentence.
- Workspace hook files never run for the agent. On the Cursor engine a repository's `.cursor/hooks.json` entries are set aside for the turn and restored; `.claude/settings*.json` hooks are set aside in a folder the runner cloned or created, and a turn on a person's own folder whose `.claude` settings carry hooks is refused, naming the file.
- Apply checks an inline block in either format. In Claude Code's (the default): events `PreToolUse` or `PostToolUse`, every matcher and condition in the shape Claude Code accepts, no `fail_closed`, and `${user_config.KEY}` only in a handler with `args`; an omitted format is filled with Claude Code's. In Cursor's, which the block names (`format: HOOK_FORMAT_CURSOR`): events `preToolUse`, `beforeShellExecution`, `beforeMCPExecution`, `postToolUse` or `afterMCPExecution`, a matcher that is `*` or a regular expression, `fail_closed` allowed, and no `condition`, `args` or `${user_config.KEY}`. Apply also refuses more than one inline block, and a `plugins` list that names a plugin twice.
- Installing a plugin with hooks, in either format, records them on the plugin and declares in the plugin's `env` every variable those hooks read. A conversation can list plugins of its own (the Session's `spec.plugins`); their hooks run too, in a chat with no agent as well.
- A plugin reference with no `version` follows the plugin's installed version. A hook that reads a variable the run does not have refuses the turn, naming the variable.
- A hook reads a plugin setting by passing `${user_config.KEY}` in its `args`; a command without `args` that names one refuses the turn, since the shell would re-read the value. Only a setting passed that way is also exported to the plugin's hooks as `CLAUDE_PLUGIN_OPTION_<KEY>`; a hook whose script reads `CLAUDE_PLUGIN_OPTION_<KEY>` for any other setting finds it unset, where Claude Code would set it.

## Declared Keys

An agent declares the environment variables it needs in `env`, a map of variable name to `EnvVarDeclaration` (`ai/stigmer/agentic/vault/v1/declaration.proto`, shared with a plugin's `status.env`). A declaration is the **schema**, never a person's value: a secret is found by its name in a vault when a run starts, and a plain setting may carry its value in the declaration.

```yaml
spec:
  env:
    API_URL:
      description: "Base URL for the target API"
      value: "https://api.example.com"
    AUTH_TOKEN:
      description: "API authentication token"
      is_secret: true
```

| Field | Description |
|---|---|
| `is_secret` | `true`: found in a vault by name when a run starts, sealed at rest and redacted in logs. A secret declaration cannot carry a value. |
| `description` | What the variable is for and where to get it. Shown where a person is asked for it. |
| `optional` | `false` (default): a run whose vaults hold no value is refused before it starts, naming the key and who must add it. `true`: the run starts without it. |
| `value` | A plain setting's own value. A vault secret with the same name takes its place. |

Which vaults a run reads: the My vault of the person sending the turn when the conversation includes it (`include_my_vault`), then the vaults the conversation lists, in order. An agent carries no vaults: it is a blueprint, and each conversation names its own. A run no person sent (a schedule, a share link, a channel, a platform client's user) uses only the vaults its conversation and that surface name. The console names the keys an agent reads before the first message.

## Run Defaults

`spec.run_config` is a `RunConfig` (`ai/stigmer/agentic/run/v1/invocation.proto`), the same settings message a message, a schedule, a channel and a share carry. A turn uses the agent's defaults wherever the message or the surface it came through sets nothing; the field table and the full precedence rule are in [RunConfig Fields](../../run/docs/run-resource-guide.md#runconfig-fields).

```yaml
spec:
  harness: HARNESS_NATIVE
  run_config:
    model_name: claude-sonnet-4.5
    thinking_mode: THINKING_MODE_ENABLED
    max_cost_usd: 2
```

- **Choices are defaults; limits are caps.** A message or a surface that names a model replaces the agent's model (and the tier and thinking that came with it). The agent's `max_cost_usd`, `max_tool_rounds` and `max_tool_result_chars` are caps a message or a surface can lower, never raise.
- **Engine-bound.** `model_name`, `service_tier` and `thinking_mode` apply only on the engine `spec.harness` names. On a conversation running the other engine, only the limits apply.
- **Versioned.** The defaults are part of the agent's content hash, so a conversation pinned to a version keeps that version's model. A conversation keeps the engine it started on; a later version naming another engine changes only new conversations.
- **Checked at save** (create and update are refused with `INVALID_ARGUMENT`):
  - `model_name` requires `spec.harness`, since each engine lists its own models.
  - `model_name` must be a model the named engine lists in the Model Registry; an unknown name is refused with a did-you-mean.
  - `SERVICE_TIER_FAST` needs a model with a fast pricing tier on that engine; `THINKING_MODE_ENABLED` needs a model the registry marks thinking-capable on that engine. Either one requires `model_name` in the same `run_config`.
  - A `harness` with no model is valid: new conversations start on that engine and the engine picks the model.

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
- [resource-references.md](resource-references.md) — `ApiResourceReference` format for referencing plugins and skills
- [plugin-integration.md](plugin-integration.md) — Plugins, their MCP servers, the two tool lists and which tools ask for approval
- [skill-integration.md](skill-integration.md) — Skill integration and injection
- [sub-agents.md](sub-agents.md) — Sub-agent delegation and permission model
- [examples.md](examples.md) — Complete YAML examples from minimal to full-featured
- [validation-checklist.md](validation-checklist.md) — Pre-apply checklist and common pitfalls
