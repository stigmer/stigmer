# Resource Discovery Guide

Before writing any `mcp_server_usages` or `skill_refs`, query the platform.
**Never guess or invent slugs.** A reference to a nonexistent resource fails at
runtime; a typo in a tool name silently disables approval policies.

## Table of Contents
1. [Discovering MCP Servers](#1-discovering-mcp-servers)
2. [Discovering Skills](#2-discovering-skills)
3. [Extracting Tool Names from Discovery Data](#3-extracting-tool-names-from-discovery-data)
4. [Handling Missing Resources](#4-handling-missing-resources)
5. [Cross-Org Resources](#5-cross-org-resources)

---

## 1. Discovering MCP Servers

### Search by keyword

```
search(query="github", resource_type="mcp_server")
search(query="database", resource_type="mcp_server")
search(query="slack notifications", resource_type="mcp_server")
```

### Fetch a specific server by slug

```
get_mcp_server(org="default", slug="github")
get_mcp_server(org="acme-corp", slug="internal-db")
```

### What to capture from the result

1. **Exact `slug`** — this goes into `mcp_server_ref.slug`
2. **`metadata.org`** — needed for cross-org absolute references
3. **`status.discovered_capabilities.tools[*].name`** — these are the **only valid**
   strings for `enabled_tools` and `tool_approval_overrides.tool_name`
4. **`spec.default_enabled_tools`** — if non-empty, these tools are active by default;
   an empty `enabled_tools` in the agent inherits this list

### Interpreting tool names from discovery

```json
"status": {
  "discovered_capabilities": {
    "tools": [
      { "name": "search_code",    "description": "..." },
      { "name": "create_pr",      "description": "..." },
      { "name": "get_file",       "description": "..." },
      { "name": "delete_repo",    "description": "..." }
    ]
  }
}
```

Copy these names **character-for-character** into `enabled_tools`. The platform does
case-sensitive matching; `Search_Code` ≠ `search_code`.

---

## 2. Discovering Skills

### Search by domain or purpose

```
search(query="code review", resource_type="skill")
search(query="kubernetes deployment", resource_type="skill")
search(query="company style guide", resource_type="skill")
```

### Fetch a specific skill by slug

```
get_skill(org="default", slug="code-review-best-practices")
get_skill(org="acme-corp", slug="internal-runbook")
```

### What to capture from the result

1. **Exact `slug`** — goes into `skill_refs[*].slug`
2. **`metadata.org`** — needed if the skill is in a different org
3. **Available tags** (e.g., `stable`, `v2`) — for version pinning decisions

---

## 3. Extracting Tool Names from Discovery Data

After calling `get_mcp_server`, locate the discovered tools:

```
result.status.discovered_capabilities.tools  →  list of { name, description, input_schema }
```

For each tool:
- `name` → use verbatim in `enabled_tools` or `tool_approval_overrides.tool_name`
- `input_schema.properties` → keys are valid `{{args.<key>}}` placeholders in approval
  message templates

**Example**: Tool `create_pr` has `input_schema.properties: {title, body, head, base}`.
Valid message: `"Create PR '{{args.title}}' from {{args.head}}"`.

If `discovered_capabilities` is absent (server never had discovery run):
- Do not guess tool names
- Inform the user the MCP server has no discovered capabilities
- Suggest running `stigmer discover mcp-server <slug>` to populate them
- Ask whether to proceed without tool filtering (empty `enabled_tools` = all tools)

---

## 4. Handling Missing Resources

### MCP server not found

```
get_mcp_server → 404 / not found
```

**Do not** create a placeholder. Tell the user:
> "I couldn't find an MCP server with slug `<slug>` in org `<org>`. Available MCP
> servers matching your intent: [list results from search]. Should I use one of these,
> or would you like to create a new McpServer resource first?"

### Skill not found

Same pattern:
> "I couldn't find a skill with slug `<slug>`. Here are the closest matches: [...].
> Should I reference one of these, or proceed without this skill?"

### No matching results at all

> "No MCP servers / skills were found for `<query>`. Please confirm whether this
> resource exists on the platform, or if you'd like to proceed without it."

Never write `slug: placeholder` or `slug: tbd` — this creates a broken agent.

---

## 5. Cross-Org Resources

Resources in a different org than the agent itself require an explicit `org` field:

```yaml
# Agent in org: acme-corp
# Referencing a public skill from org: stigmer

skill_refs:
  - org: stigmer          # explicit because it differs from agent's org
    kind: skill
    slug: web-search-guide
```

When discovering, if the resource's `metadata.org` differs from the agent's intended
org, include `org` in the reference. If they match, omit `org` for a cleaner relative
reference.
