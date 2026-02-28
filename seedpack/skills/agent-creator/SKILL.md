---
name: agent-creator
description: >
  Create, validate, and refine production-quality Stigmer Agent YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use when a user wants to create a new agent, update an existing
  agent YAML, configure MCP server integrations, add skills or sub-agents, or understand any
  part of the Agent resource schema. Covers all features: metadata, instructions, mcp_server_usages,
  skill_refs, sub_agents, env_spec, tool approval overrides, visibility, and version pinning.
---

# Agent Creator

This skill empowers you to produce valid, production-quality `agentic.stigmer.ai/v1` Agent YAML
files on the first attempt. Follow the workflow below precisely — especially the mandatory
resource-discovery steps.

## Workflow

### Step 1 — Understand the Agent's Purpose

Before writing any YAML, establish:

- **What does this agent do?** (domain, primary tasks)
- **What tools does it need?** (external systems → MCP servers)
- **What domain knowledge does it need?** (skills)
- **Does it need sub-agents?** (delegation for specialized tasks)
- **What environment variables does it require?** (credentials, config)
- **Who is the audience?** (private team use vs. public marketplace)

If the user's intent is unclear, ask focused clarifying questions before proceeding.
Never assume unstated requirements.

---

### Step 2 — Query Available Resources (MANDATORY)

**Never guess MCP server slugs, tool names, or skill slugs.** Always query the platform first.

Use the Stigmer MCP server tools:

```
search(query="<domain keywords>", kinds=["mcp_server"])  → find relevant MCP servers
search(query="<domain keywords>", kinds=["skill"])       → find relevant skills
get_mcp_server(org="local", slug="<slug>")               → get tool names + details
get_skill(org="local", slug="<slug>")                    → confirm a skill exists
```

**Decision rules after querying:**

| Situation | Action |
|---|---|
| MCP server or skill found | Use real `org` and `slug` from the query result |
| Needed resource not found | **Pause and ask the user** — do not invent a reference |
| Tool names needed for `enabled_tools` | Use exact names from `get_mcp_server` response |
| Tool names needed for `tool_approval_overrides` | Same — exact names only; typos silently break policy |

---

### Step 3 — Draft the YAML

Use the canonical structure. Apply only the fields the agent actually needs — omit the rest.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: <human-readable name>
  org: local                        # "local" for local mode; real org slug for cloud mode
  # slug: auto-generated if omitted
  # visibility: omit for private (default); visibility_public for marketplace
  # labels: { team: engineering }
  # tags: [tag1, tag2]
spec:
  description: "<1-2 sentence summary>"
  instructions: |
    <system prompt — minimum 10 characters, use | block scalar for multi-line>
  # mcp_server_usages: []
  # skill_refs: []
  # sub_agents: []
  # env_spec: {}
# NEVER include status — it is system-managed
```

#### Key field rules (memorize these):

| Rule | Detail |
|---|---|
| `apiVersion` | Exactly `agentic.stigmer.ai/v1` |
| `kind` | Exactly `Agent` |
| `instructions` min length | 10 characters — enforced by proto validation |
| `kind` in references | Always lowercase strings: `skill`, `mcp_server` — **never** `43` or `44` |
| Slug format | `^[a-z][a-z0-9-]*$` — lowercase, hyphens only, starts with letter, 1–63 chars |
| MCP server uniqueness | Each MCP server slug appears **at most once** in `mcp_server_usages` |
| Sub-agent containment | Sub-agent tools must be a **subset** of parent's tools for that server |
| Sub-agent MCP access | `mcp_access[*].mcp_server` must match a slug in parent's `mcp_server_usages` |
| `status` | **Never set** — system-managed |

For complete field definitions → see `references/schema.md`
For annotated examples → see `references/examples.md`

---

### Step 4 — Validate Before Presenting

Run the full checklist mentally before showing the YAML to the user. At minimum:

- [ ] `apiVersion` and `kind` are exact
- [ ] `instructions` is ≥ 10 characters and meaningful
- [ ] `description` is present
- [ ] All `skill_refs` use `kind: skill` and reference verified slugs
- [ ] All `mcp_server_ref` entries use `kind: mcp_server` and reference verified slugs
- [ ] No duplicate MCP server slugs in `mcp_server_usages`
- [ ] Sub-agent `enabled_tools` are subsets of parent's tools
- [ ] Sub-agent `mcp_access[*].mcp_server` values match parent's declared slugs
- [ ] Tool names in `tool_approval_overrides` are exact (typos silently break policy)
- [ ] `status` is absent
- [ ] YAML is syntactically valid

For the full checklist and pitfall reference → see `references/validation.md`

---

### Step 5 — Present and Explain

After presenting the YAML:

1. Summarize what the agent does and its key capabilities
2. Call out any assumptions made (e.g., which MCP servers or skills were selected and why)
3. Note any resources that didn't exist on the platform and what was done instead
4. Offer to adjust or extend (add sub-agents, tune tool approval policies, pin skill versions, etc.)

---

## Quick Reference: Feature Patterns

### MCP Server with Tool Restrictions

```yaml
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: <verified-slug>
    enabled_tools:
      - <exact-tool-name>     # from get_mcp_server response
```

### MCP Server with Approval Overrides

```yaml
    tool_approval_overrides:
      - tool_name: <exact-tool-name>   # typos silently fail — verify the name
        requires_approval: true
        message: "Action: {{args.param}}"   # optional; keep under 100 chars
```

### Skill Reference

```yaml
skill_refs:
  - org: local
    kind: skill
    slug: <verified-slug>
    # version: stable   # optional; omit for latest
```

### Sub-Agent (with restricted MCP access)

```yaml
sub_agents:
  - name: <unique-name>
    description: "<what triggers delegation to this sub-agent>"
    instructions: |
      <sub-agent system prompt — min 10 chars>
    mcp_access:
      - mcp_server: <slug-from-parent-mcp_server_usages>
        enabled_tools: [<subset-of-parent-tools>]
    skill_refs:            # independent of parent's skills
      - org: local
        kind: skill
        slug: <verified-slug>
```

### Environment Variables

```yaml
env_spec:
  data:
    VAR_NAME:
      description: "<what this var is for>"
      is_secret: true        # true = encrypted + redacted in logs
```

---

## Reference Files

Load these when you need detailed information:

| File | When to read |
|---|---|
| `references/schema.md` | Complete field definitions, validation rules, all message types |
| `references/examples.md` | Full annotated YAML examples for every use case |
| `references/validation.md` | Full pre-apply checklist and every common pitfall with fixes |
