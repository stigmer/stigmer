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
- [ ] All `mcp_server_ref` entries use `kind: mcp_server` (lowercase string, not `kind: 44`)
- [ ] All `org` values in references (if set) are valid organization identifiers — omit `org` for same-org references
- [ ] All `slug` values are lowercase alphanumeric with hyphens, start with a letter, 1-63 characters
- [ ] All referenced MCP servers and skills actually exist — query with `stigmer get mcp-server <slug>` or `stigmer get skill <slug>` before referencing

### MCP Server Usages

- [ ] MCP server slugs are unique within `mcp_server_usages` (no duplicate references)

### Tool Lists

- [ ] `tools` and `disallowed_tools` entries use Claude Code's names: `Read`, `Grep`, `Bash(git push *)`, `Agent(explore)`, `mcp__<server-slug>`, `mcp__<server-slug>__<tool>`, `mcp__*`. The shape is checked at apply; a malformed entry is rejected
- [ ] Each `mcp__<server-slug>` uses the slug from `mcp_server_usages`, and each tool part an exact, case-sensitive name from the server's `discovered_capabilities.tools`. Names are resolved only at run time: a misspelled entry is ignored there, and a `tools` list in which nothing resolves refuses the run
- [ ] A `tools` list names everything the agent needs, `Agent` included when it delegates to sub-agents: "only these" is exact

### Sub-Agents

- [ ] Sub-agent names are unique within `sub_agents`
- [ ] Sub-agent `instructions` are at least 10 characters
- [ ] Sub-agent `tools` name only tools the parent keeps: a sub-agent narrows the parent's tools and never widens them

### YAML Syntax

- [ ] YAML is properly formatted and syntactically valid
- [ ] Multi-line `instructions` use `|` block scalar style
- [ ] No trailing whitespace or tab characters in YAML values

## Common Pitfalls

### Using integers for `kind` in references

The proto enum uses integers internally (`skill = 43`, `mcp_server = 44`), and some proto comments previously showed `kind: 43`. In YAML, always use the lowercase string name.

```yaml
# Wrong
kind: 43
kind: 44

# Correct
kind: skill
kind: mcp_server
```

### Using uppercase or underscores in slugs

Slugs must match `^[a-z][a-z0-9-]*$` — lowercase, hyphens only, starts with a letter.

```yaml
# Wrong
slug: Code_Reviewer
slug: codeReviewer

# Correct
slug: code-reviewer
```

### Wrong capitalization in `kind` values

```yaml
# Wrong
kind: Skill
kind: MCP_SERVER
kind: McpServer

# Correct
kind: skill
kind: mcp_server
```

### Instructions too short

The `instructions` field has a 10-character minimum enforced by `buf.validate`.

```yaml
# Wrong (below minimum)
instructions: "Helper"

# Correct
instructions: "You are a helpful assistant that answers questions clearly."
```

### Sub-agent tools exceeding parent's tools

A sub-agent starts from the parent's resolved tools. Naming a tool the parent excluded does not give it back.

```yaml
# Wrong — the parent cannot delete repositories, so neither can the reviewer
disallowed_tools: [mcp__github__delete_repository]
sub_agents:
  - name: reviewer
    instructions: "Review pull requests for correctness."
    tools: [Read, mcp__github__delete_repository]

# Correct — narrow the parent's tools
disallowed_tools: [mcp__github__delete_repository]
sub_agents:
  - name: reviewer
    instructions: "Review pull requests for correctness."
    tools: [Read, mcp__github__search_code]
```

### Duplicate MCP server slugs in one agent

Each MCP server slug must appear only once in `mcp_server_usages`.

```yaml
# Wrong — github appears twice
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github
  - mcp_server_ref:
      kind: mcp_server
      slug: github

# Correct — one entry; narrow its tools with the tool lists
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github
tools: [mcp__github__search_code, mcp__github__create_pull_request]
```

### Naming MCP resource templates in a tool list

MCP servers expose two types of capabilities: **tools** (callable actions) and **resource templates** (read-only data endpoints). Only tool names belong in an `mcp__<server-slug>__<tool>` entry. A resource template name never matches a tool, so the runner ignores the entry.

```yaml
# Wrong — cloud_resource_schema is a resource template, not a tool
tools:
  - mcp__planton__cloud_resource_schema

# Correct — only tool names from discovered_capabilities.tools
tools:
  - mcp__planton__get_cloud_resource
```

When inspecting `stigmer get mcp-server <slug> -oyaml`, check `status.discovered_capabilities` carefully — `tools` and `resource_templates` are separate lists. Only use names from the `tools` list.

### Guessing resource references

Never write `slug: github` without verifying the MCP server exists. References to nonexistent resources are rejected at apply time.

```bash
# Verify before referencing
stigmer get mcp-server github
stigmer get skill code-review-best-practices
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
tools: [Read, mcp__github__serach_code]

# Correct
tools: [Read, mcp__github__search_code]
```

Always verify tool names against the MCP server before writing a list.

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
