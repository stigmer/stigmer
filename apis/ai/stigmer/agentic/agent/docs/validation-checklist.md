# Validation Checklist and Common Pitfalls

Pre-apply checklist and known pitfalls when authoring Agent YAML files.

## Pre-Apply Checklist

Run through this list before applying an Agent YAML with `stigmer apply -f`.

### Required Fields

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `Agent`
- [ ] `metadata.name` is present
- [ ] `spec.instructions` is at least 10 characters and provides meaningful behavioral guidance
- [ ] `spec.description` clearly explains the agent's purpose (strongly recommended — agents without descriptions render poorly in UI)

### Organization and Visibility

- [ ] `metadata.org` is set, or the CLI has an active organization context to resolve it from
- [ ] `metadata.visibility` is intentional — omit for the organization default, set `visibility_private` to keep a draft to yourself, `visibility_child_orgs` only from an organization that is not itself a child

### Resource References

- [ ] All `skill_refs` use `kind: skill` (lowercase string, not `kind: 43`)
- [ ] All `plugins` entries use `kind: plugin` (lowercase string, not `kind: 58`)
- [ ] All `org` values in references (if set) are valid organization identifiers — omit `org` for same-org references
- [ ] All `slug` values are lowercase alphanumeric with hyphens, start with a letter, end with a letter or digit, 2 to 63 characters
- [ ] All referenced plugins and skills actually exist — query with `stigmer get plugin <slug>` or `stigmer get skill <slug>` before referencing

### Plugins

- [ ] Each plugin is listed once in `plugins` (apply refuses a plugin listed twice)
- [ ] A plugin with a local program (stdio) MCP server is meant for conversations on a person's own runner (desktop app, CLI): a conversation hosted in a cloud sandbox is refused at create

### MCP Servers

- [ ] An agent with `mcp_servers` is applied by an organization admin: a member's write that adds a server or changes one's address or headers is refused
- [ ] Each server's `url` is `https`, or `http` on a loopback host, with no credentials or fragment; at most 20 servers
- [ ] Each `name` is 2 to 63 lowercase letters, digits and hyphens, starts with a letter, does not end with a hyphen, is listed once, does not start with `stigmer` and is not `plugin`
- [ ] No header value holds a secret: name it as `${NAME}` and keep the value in a vault (header values are stored in the agent and shown to anyone who can read it)
- [ ] No server shares a name with a server of a subagent this agent lists: the turn is refused

### Tool Lists

- [ ] `tools` and `disallowed_tools` entries use Claude Code's names: `Read`, `Grep`, `Bash(git push *)`, `Agent(explore)`, `mcp__plugin_<plugin>_<server>`, `mcp__plugin_<plugin>_<server>__<tool>`, `mcp__<server>`, `mcp__<server>__<tool>`, `mcp__*`. The shape is checked at apply; a malformed entry is rejected
- [ ] Each `mcp__plugin_<plugin>_<server>` names a plugin from `plugins` and a server from its `status.mcp_servers`, and each tool part an exact, case-sensitive name the server lists (`stigmer connect plugin <plugin>`). Names are resolved only at run time: a misspelled entry is ignored there, and a `tools` list in which nothing resolves refuses the run
- [ ] A `tools` list names everything the agent needs, `Agent` included when it hands work to subagents: "only these" is exact

### Subagents

- [ ] Every `subagents` entry uses `kind: agent` and names a saved agent that exists before this agent is saved: apply the listed agents first
- [ ] Each agent is listed once, at most 20, and not this agent itself
- [ ] No listed agent has `subagents` of its own: a subagent cannot hand work on
- [ ] You can run every agent you list, and none is more private than this agent
- [ ] Each listed agent carries what its work needs — its own plugins, tool lists, skills and `env` — since it gets none of this agent's
- [ ] No `sub_agents` block remains: apply refuses it; write each one as an Agent of its own and list it

### YAML Syntax

- [ ] YAML is properly formatted and syntactically valid
- [ ] Multi-line `instructions` use `|` block scalar style
- [ ] No trailing whitespace or tab characters in YAML values

## Common Pitfalls

### Using integers for `kind` in references

The proto enum uses integers internally (`skill = 43`, `plugin = 58`), and some proto comments previously showed `kind: 43`. In YAML, always use the lowercase string name.

```yaml
# Wrong
kind: 43
kind: 58

# Correct
kind: skill
kind: plugin
```

### Using uppercase or underscores in slugs

Slugs must match `^[a-z][a-z0-9-]*$` — lowercase, hyphens only, starts with a letter.

```yaml
# Wrong
slug: Variance_Reporter
slug: varianceReporter

# Correct
slug: variance-reporter
```

### Wrong capitalization in `kind` values

```yaml
# Wrong
kind: Skill
kind: PLUGIN
kind: Plugin

# Correct
kind: skill
kind: plugin
```

### Instructions too short

The `instructions` field has a 10-character minimum enforced by `buf.validate`.

```yaml
# Wrong (below minimum)
instructions: "Helper"

# Correct
instructions: "You are a helpful assistant that answers questions clearly."
```

### Expecting a subagent to borrow the parent's tools

A saved subagent runs with its own plugins and tool lists, never the parent's. A subagent that names a plugin's tool without listing the plugin finds no such tool.

```yaml
# Wrong — the reconciler lists no plugin, so it has no ledger tools
kind: Agent
metadata:
  name: bank-reconciler
spec:
  instructions: "Match bank statement lines to ledger entries."
  tools: [Read, mcp__plugin_ledger_ledger__get_ledger]

# Correct — the reconciler lists the plugin its tools come from
kind: Agent
metadata:
  name: bank-reconciler
spec:
  instructions: "Match bank statement lines to ledger entries."
  plugins:
    - kind: plugin
      slug: ledger
  tools: [Read, mcp__plugin_ledger_ledger__get_ledger]
```

### Writing subagents inside an agent

The `sub_agents` field is gone, and apply refuses a manifest that uses it. Save each one as an Agent and list it.

```yaml
# Wrong — refused at apply
sub_agents:
  - name: bank-reconciler
    instructions: "Match bank statement lines to ledger entries."

# Correct — bank-reconciler is an Agent of its own, saved first
subagents:
  - kind: agent
    slug: bank-reconciler
```

### Listing a plugin twice

Each plugin appears only once in `plugins`; apply refuses a plugin listed twice.

```yaml
# Wrong — github appears twice
plugins:
  - kind: plugin
    slug: github
  - kind: plugin
    slug: github

# Correct — one entry; narrow its tools with the tool lists
plugins:
  - kind: plugin
    slug: github
tools: [mcp__plugin_github_github__search_code, mcp__plugin_github_github__create_pull_request]
```

### Naming MCP resource templates in a tool list

MCP servers expose two types of capabilities: **tools** (callable actions) and **resource templates** (read-only data endpoints). Only tool names belong in an `mcp__plugin_<plugin>_<server>__<tool>` entry. A resource template name never matches a tool, so the runner ignores the entry.

```yaml
# Wrong — cloud_resource_schema is a resource template, not a tool
tools:
  - mcp__plugin_planton_planton__cloud_resource_schema

# Correct — only tool names the server lists
tools:
  - mcp__plugin_planton_planton__get_cloud_resource
```

`stigmer connect plugin <plugin>` lists only tools; use names from its output.

### Guessing resource references

Never write `slug: github` without verifying the plugin is installed. References to nonexistent resources are rejected at apply time.

```bash
# Verify before referencing
stigmer get plugin github
stigmer get skill variance-report
```

### Missing required fields in references

Both `kind` and `slug` are required in every `ApiResourceReference`. The `org` field is optional (omit for same-org relative references).

```yaml
# Wrong — missing kind and slug
skill_refs:
  - org: acme-corp

# Correct (relative reference)
skill_refs:
  - kind: skill
    slug: my-skill

# Correct (absolute reference)
skill_refs:
  - org: acme-corp
    kind: skill
    slug: my-skill
```

### Misspelled tool names

Tool lists are resolved at run time, against the tools the run has. A misspelled entry names no tool and is ignored, with a log line. In `tools`, that means the tool you meant is not available; if no entry resolves at all, the run is refused, naming the entries.

```yaml
# Wrong — typo: the agent loses search_code instead of gaining it
tools: [Read, mcp__plugin_github_github__serach_code]

# Correct
tools: [Read, mcp__plugin_github_github__search_code]
```

Always verify tool names against the MCP server before writing a list (`stigmer connect plugin <plugin>`). An agent's own server cannot be listed this way yet ([#2325](https://github.com/stigmer/stigmer/issues/2325)): name it whole as `mcp__<server>`, or take the tool names from the server's own documentation.

### Missing `metadata.org`

Set `metadata.org` explicitly, or ensure the CLI has an active organization context to resolve it from.

```yaml
# Recommended — explicit org
metadata:
  name: my-agent
  org: acme-corp

# Also works — org resolved from CLI context
metadata:
  name: my-agent
```
