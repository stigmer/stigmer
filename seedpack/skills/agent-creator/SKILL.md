---
name: agent-creator
description: >
  Creates valid, production-quality Stigmer Agent YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill whenever a user wants to create,
  write, draft, generate, or update a Stigmer Agent definition. Covers all
  agent features: instructions, MCP server usages, skill references, sub-agents,
  tool approval overrides, environment variables, and metadata (visibility, tags,
  labels). Always discovers real platform resources before referencing them.
---

# Agent Creator

Produce correct, production-ready `agentic.stigmer.ai/v1` Agent YAML on the
first attempt by following the four-phase workflow below.

## Phase 1 — Clarify Intent

Before writing any YAML, resolve these questions from the user's request or by
asking:

1. **Purpose** — What does this agent do? What is its core task?
2. **Tools needed** — Does the agent need to act on external systems
   (GitHub, Slack, databases, APIs)? If yes, which ones?
3. **Knowledge needed** — Does it need specialized domain knowledge packaged
   as a Skill?
4. **Delegation** — Should specialized sub-tasks be routed to focused
   sub-agents?
5. **Approvals** — Are any tool calls sensitive enough to require human
   confirmation before execution?

If the intent is ambiguous, **ask before proceeding**. Never guess.

---

## Phase 2 — Discover Real Platform Resources

> **Rule**: Never write a `slug` for an MCP server or skill that you have
> not confirmed exists on the platform. Guessing or hallucinating slugs creates
> YAML that fails at runtime with no obvious error message.

### If the user mentions tools or MCP servers

Use the Stigmer MCP server tools to search and confirm:

```
search(query="<tool category, e.g. github>")
get_mcp_server(slug="<candidate-slug>")
```

Collect from each result:
- Confirmed `slug` and `org`
- Available tool names (from `spec.default_enabled_tools` or discovered
  capabilities) — these are the only valid values for `enabled_tools`

### If the user mentions skills or domain knowledge

```
search(query="<domain, e.g. code review>")
get_skill(slug="<candidate-slug>")
```

Collect confirmed `slug`, `org`, and available `version` tags.

### If a resource does not exist

**Stop and ask the user.** Do not invent a slug. Options to offer:
- Use a different existing resource that covers the need
- Skip the reference for now and add it later
- Note that the resource must be created first

---

## Phase 3 — Assemble the YAML

Use the structure below. See `references/schema.md` for every field's rules
and `references/examples.md` for annotated complete examples.

### Top-level skeleton

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: <human-readable-name>
  org: <org-slug>            # use the STIGMER_ORG_ID environment variable
  # Optional metadata:
  # slug: <url-friendly-id>  # auto-derived from name if omitted
  # visibility: visibility_public   # omit for private (default)
  # tags: [tag1, tag2]
  # labels:
  #   key: value
spec:
  description: "<1-2 sentences for UI and marketplace>"
  instructions: |
    <system prompt — at least 10 characters, use | block scalar>
  # Optional:
  # mcp_server_usages: [...]
  # skill_refs: [...]
  # sub_agents: [...]
  # env_spec: { data: { VAR: { description: "...", is_secret: true } } }
```

### Adding MCP server usages

Only add entries for servers confirmed in Phase 2.

```yaml
mcp_server_usages:
  - mcp_server_ref:
      org: <confirmed-org>
      kind: mcp_server          # always lowercase "mcp_server"
      slug: <confirmed-slug>
    enabled_tools:              # omit to use server's default_enabled_tools
      - <exact-tool-name>       # case-sensitive; must match tools/list
    tool_approval_overrides:    # optional HITL gates
      - tool_name: <exact-tool-name>
        requires_approval: true
        message: "Human-readable message. Supports {{args.field}} placeholders."
```

**Uniqueness rule**: each `mcp_server_ref.slug` must appear at most once
within `mcp_server_usages`. Consolidate all tools for one server into a
single entry.

### Adding skill references

Only add entries for skills confirmed in Phase 2.

```yaml
skill_refs:
  - org: <confirmed-org>
    kind: skill               # always lowercase "skill"
    slug: <confirmed-slug>
    # version: stable         # optional; omit for latest
```

### Adding sub-agents

Sub-agents are defined **inline** — they are not separate resources.

```yaml
sub_agents:
  - name: <unique-name-within-parent>   # required; used for routing
    description: "<what this sub-agent specializes in>"
    instructions: |
      <at least 10 characters>
    mcp_access:                 # subset of parent's mcp_server_usages
      - mcp_server: <slug>      # must match a slug in parent's mcp_server_usages
        enabled_tools:          # must be a subset of parent's enabled_tools
          - <exact-tool-name>
    skill_refs:                 # independent of parent — any skill is valid
      - org: <org>
        kind: skill
        slug: <slug>
```

**Sub-agent permission rules** (enforced at runtime):
- `mcp_access[*].mcp_server` must match a slug from the parent's
  `mcp_server_usages`.
- `mcp_access[*].enabled_tools` must be a **subset** of the parent's
  `enabled_tools` for that server. Sub-agents can restrict but never expand.
- An empty `enabled_tools` in `mcp_access` means "all tools the parent has
  for this server" — still bounded by parent configuration.
- If a sub-agent should have no tool access, omit `mcp_access` entirely.

---

## Phase 4 — Validate Before Presenting

Run every item on this checklist mentally before showing the YAML to the user.

### Required fields
- [ ] `apiVersion: agentic.stigmer.ai/v1` — exact string
- [ ] `kind: Agent` — exact string, capital A
- [ ] `metadata.name` — present
- [ ] `spec.instructions` — present, at least 10 characters

### Metadata
- [ ] `metadata.org` — set to the value of `STIGMER_ORG_ID` environment variable
- [ ] `metadata.visibility` — `visibility_public` only for marketplace agents;
       omit for private (default)
- [ ] `metadata.slug` (if provided) — lowercase alphanumeric + hyphens, starts
       with a letter, 1-63 chars

### Resource references (every `skill_refs` and `mcp_server_ref` entry)
- [ ] `org` — present and valid
- [ ] `kind` — lowercase string: `skill` or `mcp_server` (never integers 43/44)
- [ ] `slug` — present, confirmed to exist, `^[a-z][a-z0-9-]*$`, 1-63 chars

### MCP server usages
- [ ] All slugs are unique within `mcp_server_usages`
- [ ] `enabled_tools` values are exact tool names from that server's `tools/list`
- [ ] `tool_approval_overrides[*].tool_name` — exact, case-sensitive; a typo
       silently disables the approval (no runtime error)

### Sub-agents
- [ ] Each sub-agent `name` is unique within `sub_agents`
- [ ] Each sub-agent `instructions` ≥ 10 characters
- [ ] Each `mcp_access[*].mcp_server` matches a slug in parent `mcp_server_usages`
- [ ] Each `mcp_access[*].enabled_tools` is a subset of the parent's
       `enabled_tools` for that server

### YAML format
- [ ] Multi-line instructions use `|` block scalar
- [ ] No tabs; consistent 2-space indentation
- [ ] No `status` field (system-managed; never authored by users)

If any check fails, fix it before presenting the YAML.

---

## Reference Files

Load these when you need them:

- **`references/schema.md`** — Complete field reference for every Agent YAML
  field, derived from the proto schemas. Load when you need precise field
  definitions, format constraints, or enum values.
- **`references/validation-rules.md`** — Full validation rule set, common
  pitfalls with wrong/correct examples, and edge cases. Load when an authoring
  decision feels uncertain.
- **`references/examples.md`** — Annotated YAML examples: minimal, skills-only,
  MCP-only, sub-agents, full-featured, cloud/public. Load when you want a
  concrete starting point.
