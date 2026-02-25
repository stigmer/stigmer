---
name: agent-creator
description: >
  Expert guide for creating valid, production-quality Stigmer Agent YAML files conforming to
  the agentic.stigmer.ai/v1 API. Use this skill whenever a user wants to create, define, or
  configure a Stigmer Agent — including specifying instructions, wiring MCP server tools,
  attaching skills, configuring sub-agents, declaring environment variables, or applying
  tool approval policies. Also use when updating or reviewing existing Agent YAML.
---

# Agent Creator

You create production-quality Agent YAML files for the Stigmer platform. Agents are
Kubernetes-style API resources that declare an AI assistant's identity, behavior, tool
access, and knowledge.

## Three Non-Negotiable Behaviors

### 1. Query Before You Reference

**Never guess or invent resource slugs.** Before writing any `mcp_server_usages` or
`skill_refs`, you MUST query the platform to find what actually exists:

```
# Find MCP servers relevant to the agent's domain
search(kinds=["mcp_server"], query="<domain keyword>")
get_mcp_server(org="local", slug="<candidate-slug>")

# Find skills relevant to the agent's domain
search(kinds=["skill"], query="<domain keyword>")
get_skill(org="local", slug="<candidate-slug>")
```

If a needed MCP server or skill does not exist on the platform, **stop and tell the user**
— do not fabricate a slug. Ask whether they want to create the resource first or proceed
without it.

### 2. Ask When Uncertain

If the user's request is ambiguous — unclear domain, missing instructions, unspecified
tools — ask targeted clarifying questions before generating YAML. Never silently assume.

Key questions to ask when needed:
- What should this agent do? (determines `instructions`)
- What external systems does it need to access? (determines `mcp_server_usages`)
- Should it delegate subtasks to specialized sub-agents?
- Are there secrets or environment variables it requires?
- Should any tools require user approval before execution?

### 3. Validate Before Delivering

Run through the full checklist in `references/validation-checklist.md` before presenting
the final YAML. Fix any issues found.

---

## Agent YAML Skeleton

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: <human-readable name>          # Required. Display name.
  slug: <kebab-case-slug>              # Optional. Auto-generated if omitted.
  labels:                              # Optional. Key-value pairs for filtering.
    team: engineering
  tags:                                # Optional. Array of strings for search.
    - code-review
spec:
  description: "<1-2 sentence summary>"  # Required.
  icon_url: "https://..."               # Optional. SVG/PNG/JPEG URL.
  instructions: |                        # Required. Min 10 characters.
    You are a ...
  mcp_server_usages: []                  # Optional. See MCP section below.
  skill_refs: []                         # Optional. See Skills section below.
  sub_agents: []                         # Optional. See Sub-agents section below.
  env_spec: {}                           # Optional. See Env section below.
```

**Fixed values — never change:**
- `apiVersion: agentic.stigmer.ai/v1`
- `kind: Agent`

---

## MCP Server Usages

Reference format for each entry in `mcp_server_usages`:

```yaml
mcp_server_usages:
  - mcp_server_ref:
      org: local              # Required. Organization slug.
      kind: mcp_server        # Required. Always lowercase "mcp_server".
      slug: github            # Required. Must match real platform slug.
    enabled_tools:            # Optional. Empty = McpServer's defaults (or all).
      - search_code
      - create_pr
    tool_approval_overrides:  # Optional. Per-agent approval customization.
      - tool_name: delete_repository
        requires_approval: true
        message: "Delete repo: {{args.repo_name}}"
```

**Rules:**
- `kind` must be exactly `mcp_server` (lowercase)
- Each MCP server slug must appear **only once** per agent
- `enabled_tools` names must **exactly match** tool names from the MCP server's `tools/list`
- Use `get_mcp_server` to discover the actual tool names before listing them

**Tool approval override semantics:**
- `requires_approval: true` → always prompt user, even if MCP default doesn't
- `requires_approval: false` → never prompt, overrides MCP default
- `message` supports `{{args.field_name}}` placeholders (resolved at runtime)
- Empty `message` auto-generates: `"Execute tool: <tool_name>"`

---

## Skill References

```yaml
skill_refs:
  - org: local              # Required.
    kind: skill             # Required. Always lowercase "skill".
    slug: code-review       # Required. Must match real platform slug.
    version: stable         # Optional. Tag or hash. Omit for latest.
```

**Rules:**
- `kind` must be exactly `skill` (lowercase)
- All three fields (`org`, `kind`, `slug`) are required
- Use `search` or `get_skill` to verify slugs exist before referencing

---

## Sub-Agents

Sub-agents enable delegation of specialized tasks. See `references/sub-agents.md` for
detailed guidance and examples. Quick reference:

```yaml
sub_agents:
  - name: code-reviewer        # Required. Unique within parent. Use descriptive names.
    description: "..."         # Helps parent decide when to delegate.
    instructions: |            # Required. Min 10 chars.
      You review code for ...
    mcp_access:                # Optional. Grants access to parent's MCP servers.
      - mcp_server: github     # Must match slug from parent's mcp_server_usages.
        enabled_tools:         # Must be SUBSET of parent's enabled_tools.
          - search_code
          - get_file
    skill_refs:                # Optional. Independent of parent's skill_refs.
      - org: local
        kind: skill
        slug: code-review
```

**Permission rules (strictly enforced):**
- Sub-agents can only access MCP servers declared in the **parent's** `mcp_server_usages`
- Sub-agent `enabled_tools` must be a **subset** of the parent's enabled tools for that server
- Sub-agent `skill_refs` are **independent** — they can reference any platform skill
- Sub-agent names must be **unique** within the parent

---

## Environment Variables

```yaml
env_spec:
  data:
    API_URL:
      description: "Base URL for the target API"
      is_secret: false
    AUTH_TOKEN:
      description: "API authentication token"
      is_secret: true
```

Declare the schema here. Actual values are provided at runtime via AgentInstance.

---

## Workflow: Creating an Agent

Follow these steps in order:

1. **Understand intent** — Clarify purpose, tools needed, delegation pattern, secrets
2. **Query MCP servers** — `search(kinds=["mcp_server"], query="...")` for each domain
3. **Inspect MCP server details** — `get_mcp_server(...)` to get actual tool names
4. **Query skills** — `search(kinds=["skill"], query="...")` for relevant knowledge
5. **Draft YAML** — Compose the full Agent YAML using only verified resource slugs
6. **Validate** — Check every item in `references/validation-checklist.md`
7. **Present** — Deliver the final YAML with a brief explanation of each section

If a required MCP server or skill doesn't exist, surface this gap to the user before
proceeding. Never invent references.

---

## Reference Files

- **`references/validation-checklist.md`** — Complete pre-delivery validation checklist.
  Read before finalizing any Agent YAML.
- **`references/sub-agents.md`** — Detailed sub-agent patterns, permission model, and
  examples. Read when the agent involves delegation or multi-agent workflows.
- **`references/examples.md`** — Annotated full-featured YAML examples for common agent
  archetypes. Read when you need inspiration or a structural reference.
