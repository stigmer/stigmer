---
name: agent-creator
description: >
  Create valid, production-quality Stigmer Agent YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill when asked to create, write,
  generate, or author a Stigmer Agent definition — including agents with MCP
  server tool integrations, skill references, sub-agents, environment variables,
  and human-in-the-loop approval policies.
---

# Agent Creator

Produce `agentic.stigmer.ai/v1` Agent YAML files that are correct on the first
attempt. Follow every step below in order. Do not skip discovery or validation.

## Step 1 — Clarify Intent Before Writing Anything

Ask the user:

1. **What should this agent do?** (If already clear, proceed.)
2. **What tools does it need?** (MCP servers? Which actions — e.g., create PR, search
   code?)
3. **What domain knowledge?** (Skills? Approval checkpoints?)
4. **Org context?** (If not in a Stigmer project, ask for `metadata.org`; default to
   `default` only if they confirm.)
5. **Sub-agents?** (Only if complexity warrants delegation.)

Do **not** assume. If the stated intent is unclear, pause and ask. Prefer one focused
question over multiple at once.

## Step 2 — Discover Real Resources (MANDATORY)

**Never guess or hallucinate resource slugs.** Before writing any `mcp_server_usages`
or `skill_refs`, use the Stigmer MCP server tools to query what exists:

```
search(query="<domain keyword>", resource_type="mcp_server")
search(query="<domain keyword>", resource_type="skill")
get_mcp_server(org="<org>", slug="<candidate-slug>")
get_skill(org="<org>", slug="<candidate-slug>")
```

Rules:
- If a needed MCP server or skill **does not exist**, stop and tell the user. Do
  not invent placeholder slugs.
- If multiple candidates exist, show the user the options and ask which to use.
- Capture the **exact slug**, the **org** (if needed for cross-org references), and
  for MCP servers get the list of actual tool names from the discovery data.

See `references/discovery.md` for tool call patterns and how to extract tool names
from `status.discovered_capabilities`.

## Step 3 — Draft the YAML

Build the YAML top-down. See `references/schema.md` for the full field reference and
`references/examples.md` for annotated complete examples.

### Skeleton

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: <kebab-case-name>
  org: <org>                    # omit if using project context
spec:
  description: "<1–2 sentence summary for UI/marketplace>"
  instructions: |
    <system prompt — minimum 10 characters; use rich behavioral guidance>
  mcp_server_usages: []         # see Step 3a
  skill_refs: []                # see Step 3b
  sub_agents: []                # see Step 3c; omit if none
```

### 3a — MCP Server Usages

For each discovered MCP server:

```yaml
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: <exact-slug>        # discovered in Step 2
      org: <org>                # only if cross-org (different from agent's org)
    enabled_tools:              # list ONLY what this agent actually needs
      - <tool-name-exact>       # copy exactly from discovered_capabilities
    tool_approval_overrides:    # optional HITL checkpoints
      - tool_name: <tool>
        requires_approval: true
        message: "<verb> <object>: {{args.<field>}}"
```

Constraints (enforced by proto validation):
- `kind` must be the string `mcp_server` (never `44` or `McpServer`)
- Each MCP server slug must appear **exactly once** across all `mcp_server_usages`
- `enabled_tools` must contain real tool names — copy from `discovered_capabilities.tools[*].name`
- Tool names in `tool_approval_overrides` must also be exact (typos silently disable approval)

### 3b — Skill References

```yaml
skill_refs:
  - kind: skill
    slug: <exact-slug>          # discovered in Step 2
    org: <org>                  # only if cross-org
    version: stable             # omit for latest; use "stable" for production
```

Constraints:
- `kind` must be the string `skill` (never `43` or `Skill`)
- Both `kind` and `slug` are required in every entry
- `org` is optional — omit it for same-org relative references

### 3c — Sub-Agents

Only add sub-agents when the task genuinely benefits from delegation. See
`references/sub-agents.md` for the full model.

```yaml
sub_agents:
  - name: <kebab-case-role>     # unique within parent
    description: "<what triggers delegation>"
    instructions: |
      <focused instructions — min 10 chars>
    mcp_access:                 # only servers the parent declares
      - mcp_server: <parent-slug>   # slug only — NOT kind/org
        enabled_tools:              # must be SUBSET of parent's tools
          - <tool-name>
    skill_refs:                     # independent of parent's skills
      - kind: skill
        slug: <slug>
```

Sub-agent permission rules (validated at runtime):
- `mcp_access[*].mcp_server` must match a slug from the parent's `mcp_server_usages`
- `mcp_access[*].enabled_tools` must be a **subset** of the parent's `enabled_tools` for
  that server — sub-agents can never expand tool access beyond the parent
- Sub-agent `skill_refs` are independent and can reference any skill

## Step 4 — Validate Before Presenting

Before showing the final YAML, run through this checklist mentally:

| Rule | Check |
|---|---|
| `apiVersion` = `agentic.stigmer.ai/v1` | ✓/✗ |
| `kind` = `Agent` | ✓/✗ |
| `metadata.name` present | ✓/✗ |
| `spec.instructions` ≥ 10 chars | ✓/✗ |
| `spec.description` present (strongly recommended) | ✓/✗ |
| All `kind` fields use lowercase strings (`skill`, `mcp_server`) | ✓/✗ |
| All slugs are `^[a-z][a-z0-9-]*$`, 1-63 chars | ✓/✗ |
| No duplicate MCP server slugs in `mcp_server_usages` | ✓/✗ |
| All `enabled_tools` / `tool_approval_overrides.tool_name` are exact (from discovery) | ✓/✗ |
| Sub-agent tools ⊆ parent tools for each server | ✓/✗ |
| Sub-agent `mcp_access[*].mcp_server` references only parent's MCP slugs | ✓/✗ |
| `metadata.status` absent (never set by users) | ✓/✗ |

Fix any failures before presenting the YAML.

## Step 5 — Present and Explain

Deliver the YAML in a fenced code block. Follow with a brief explanation:

- What the agent does and when to use it
- Which MCP servers and tools are enabled (and why those specific tools)
- Which skills are attached and what knowledge they provide
- Any HITL approval checkpoints and what they protect
- Any sub-agents and their delegation boundaries
- How to apply: `stigmer apply -f <filename>.yaml`

---

## Reference Files

Load these only when needed — they are detailed and token-heavy:

- **`references/schema.md`** — Full field reference for all Agent YAML fields,
  metadata options, visibility, env_spec. Load when authoring any non-trivial agent.
- **`references/discovery.md`** — MCP server and skill discovery tool call patterns,
  extracting exact tool names, handling missing resources.
- **`references/examples.md`** — Annotated complete examples: minimal, with skills,
  with MCP servers, with sub-agents, full-featured, marketplace.
- **`references/sub-agents.md`** — Sub-agent permission model, mcp_access, delegation
  routing patterns. Load when the agent needs sub-agents.
- **`references/hitl.md`** — HITL tool approval policy chain, `tool_approval_overrides`,
  message template placeholders. Load when configuring approval checkpoints.
