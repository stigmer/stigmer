# Validation Checklist and Common Pitfalls

Pre-apply checklist and known pitfalls when authoring Agent YAML files.

## Pre-Apply Checklist

Run through this list before applying an Agent YAML with `stigmer agent apply`.

### Required Fields

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `Agent`
- [ ] `metadata.name` is present
- [ ] `spec.instructions` is at least 10 characters and provides meaningful behavioral guidance
- [ ] `spec.description` clearly explains the agent's purpose (strongly recommended — agents without descriptions render poorly in UI)

### Organization and Visibility

- [ ] `metadata.org` is set appropriately — `local` for local mode, your org slug for cloud mode
- [ ] `metadata.visibility` is intentional — omit for private (default), set `visibility_public` only for marketplace publishing

### Resource References

- [ ] All `skill_refs` use `kind: skill` (lowercase string, not `kind: 43`)
- [ ] All `mcp_server_ref` entries use `kind: mcp_server` (lowercase string, not `kind: 44`)
- [ ] All `org` values in references are valid organization identifiers
- [ ] All `slug` values are lowercase alphanumeric with hyphens, start with a letter, 1-63 characters
- [ ] All referenced MCP servers and skills actually exist — query with `stigmer mcp-server get <slug>` or `stigmer skill get <slug>` before referencing

### MCP Server Usages

- [ ] MCP server slugs are unique within `mcp_server_usages` (no duplicate references)
- [ ] `enabled_tools` contain tool names that actually exist on the referenced MCP server
- [ ] `tool_approval_overrides` use exact, case-sensitive tool names matching the MCP server's `tools/list`

### Sub-Agents

- [ ] Sub-agent names are unique within `sub_agents`
- [ ] Sub-agent `instructions` are at least 10 characters
- [ ] Sub-agent `mcp_access[*].mcp_server` references only slugs from the parent's `mcp_server_usages`
- [ ] Sub-agent `mcp_access[*].enabled_tools` are subsets of the parent's enabled tools for each MCP server

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

Sub-agent `enabled_tools` must be a strict subset of the parent's enabled tools for each MCP server.

```yaml
# Wrong — parent only enabled search_code and get_file
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools:
          - search_code
          - delete_repo  # NOT in parent's enabled_tools

# Correct
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools:
          - search_code  # subset of parent's tools
```

### Duplicate MCP server slugs in one agent

Each MCP server slug must appear only once in `mcp_server_usages`.

```yaml
# Wrong — github appears twice
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
    enabled_tools: [search_code]
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
    enabled_tools: [create_pr]

# Correct — single entry with all tools
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
    enabled_tools: [search_code, create_pr]
```

### Guessing resource references

Never write `slug: github` without verifying the MCP server exists. References to nonexistent resources will fail at runtime.

```bash
# Verify before referencing
stigmer mcp-server get github
stigmer skill get code-review-best-practices
```

### Missing required fields in references

All three fields (`org`, `kind`, `slug`) are required in every `ApiResourceReference`.

```yaml
# Wrong — missing kind and slug
skill_refs:
  - org: local

# Correct
skill_refs:
  - org: local
    kind: skill
    slug: my-skill
```

### Sub-agent `mcp_access` referencing nonexistent parent MCP server

The `mcp_server` field in `mcp_access` must match a `slug` from the parent's `mcp_server_usages`.

```yaml
# Wrong — parent has no slug: slack in mcp_server_usages
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: slack  # parent doesn't have this

# Correct — only reference MCP servers the parent declares
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: github  # must exist in parent's mcp_server_usages
```

### Silent failure from typos in tool approval overrides

If a `tool_name` in `tool_approval_overrides` does not match any tool in the MCP server's `tools/list`, the override is **silently ignored**. No error, no warning — the approval policy simply does not apply.

```yaml
# Dangerous — typo means no approval is enforced
tool_approval_overrides:
  - tool_name: delet_repository  # typo: missing 'e'
    requires_approval: true
    message: "Delete repository: {{args.repo_name}}"

# Correct
tool_approval_overrides:
  - tool_name: delete_repository
    requires_approval: true
    message: "Delete repository: {{args.repo_name}}"
```

Always verify tool names against the MCP server before writing overrides.

### Missing `metadata.org` in cloud mode

In cloud mode, `metadata.org` is required. Omitting it will fail validation.

```yaml
# Wrong in cloud mode — no org specified
metadata:
  name: my-agent

# Correct for cloud mode
metadata:
  name: my-agent
  org: acme-corp
```

In local mode, `org` defaults to `local` if omitted.
