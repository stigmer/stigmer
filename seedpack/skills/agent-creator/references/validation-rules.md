# Validation Rules

Complete validation checklist derived from proto schemas. Verify every rule before presenting YAML.

## Required Field Checks

| Check | Rule |
|---|---|
| `apiVersion` | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Must be exactly `Agent` |
| `metadata` | Must be present |
| `metadata.name` | Must be present and non-empty |
| `spec.instructions` | Must be ≥ 10 characters |

## Naming Conventions

| Field | Pattern | Notes |
|---|---|---|
| `metadata.slug` | `^[a-z][a-z0-9-]*$`, 1-63 chars | Auto-generated from name if omitted |
| `metadata.org` | `^[a-z][a-z0-9-]*$` | Lowercase, hyphens only |
| All `slug` in refs | `^[a-z][a-z0-9-]*$`, 1-63 chars | Must start with letter |
| Sub-agent `name` | string, unique within sub_agents | Used for delegation routing |

## Reference Kind Values

Always use **lowercase string names** in YAML, never integers or capitalized forms.

```yaml
# CORRECT
kind: skill
kind: mcp_server

# WRONG — all of these will fail
kind: 43          # integer
kind: 44          # integer
kind: Skill       # capitalized
kind: MCP_SERVER  # uppercase
kind: McpServer   # camelCase
```

## MCP Server Usage Rules

1. **Unique slugs**: each `mcp_server_ref.slug` must appear only once in `mcp_server_usages`
2. **Kind constraint**: `mcp_server_ref.kind` must be `mcp_server`
3. **Tool names**: `enabled_tools` must match MCP server's tools/list exactly (case-sensitive) — once the server has discovered capabilities, apply rejects unknown names with an error listing the valid tools; before the first connect, unknown names are warned and ignored at execution
4. **Silent failures**: typos in approval-override `tool_name` are silently ignored — no error, no effect

## Sub-Agent Permission Rules

These are the most error-prone rules. Verify carefully:

1. **Unique names**: each sub-agent `name` must be unique within `sub_agents`
2. **Instructions minimum**: sub-agent `instructions` must be ≥ 10 characters
3. **MCP access containment**: `mcp_access[].mcp_server` must reference a slug from the **parent's** `mcp_server_usages`
4. **Tool subset**: `mcp_access[].enabled_tools` must be a **subset** of the parent's `enabled_tools` for that MCP server
5. **No expansion**: sub-agents can restrict tools, never expand beyond parent
6. **No MCP access default**: sub-agents with no `mcp_access` have zero tool access
7. **Skill independence**: sub-agent `skill_refs` are independent of parent — can reference any skill

### Sub-Agent Tool Subset Verification

```yaml
# Parent grants: [search_code, create_pr, get_file, create_issue]
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github
    enabled_tools: [search_code, create_pr, get_file, create_issue]

sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]  # ✓ subset
  - name: writer
    mcp_access:
      - mcp_server: github
        enabled_tools: [create_pr, delete_repo]  # ✗ delete_repo not in parent
```

## Visibility Values

Only two valid values (use exact strings):
- `visibility_private` (default if omitted)
- `visibility_public` (for marketplace publishing)

## Tool Approval Override Rules

1. `tool_name` minimum 1 character, must match MCP server tools exactly
2. `requires_approval: true` — adds approval even if McpServer default doesn't require it
3. `requires_approval: false` — removes approval even if McpServer default requires it
4. `message` supports `{{args.field}}` placeholders; keep under 100 characters
5. If `message` is empty and approval is required, auto-generates "Execute tool: {tool_name}"
6. Approval chain priority: McpServer defaults (lowest) → Agent overrides → AgentExecution.auto_approve_all (highest)

## YAML Syntax Rules

1. Use `|` block scalar for multi-line `instructions`
2. No tabs — YAML requires spaces
3. No trailing whitespace in values
4. `status` field is system-managed — **never set in user YAML**

## Common Mistakes Quick Reference

| Mistake | Fix |
|---|---|
| `kind: 43` or `kind: 44` | Use `kind: skill` or `kind: mcp_server` |
| `kind: Skill` or `kind: MCP_SERVER` | Use lowercase: `kind: skill`, `kind: mcp_server` |
| `slug: Code_Reviewer` | Use kebab-case: `slug: code-reviewer` |
| Instructions < 10 chars | Write meaningful instructions |
| Duplicate MCP server slugs | Combine into single entry with all tools |
| Sub-agent tool not in parent | Verify tool exists in parent's enabled_tools |
| Sub-agent mcp_server not in parent | Verify slug exists in parent's mcp_server_usages |
| Guessing resource slugs | Use search/get tools to verify existence first |
| Setting `status` fields | Remove — status is system-managed |
