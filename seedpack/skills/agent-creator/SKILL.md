---
name: agent-creator
description: >
  Produces valid, production-quality Stigmer Agent YAML files conforming to
  agentic.stigmer.ai/v1. Use this skill whenever a user wants to create,
  update, or review a Stigmer Agent definition—including agents with MCP server
  integrations, skill references, sub-agents, environment variables, tool
  approval overrides, or marketplace visibility.
---

# Agent Creator

Produce flawless `agentic.stigmer.ai/v1` Agent YAML on the first attempt by
following these four phases: **Discover → Clarify → Draft → Validate**.

---

## Phase 1 — Discover Available Resources

Before writing any `mcp_server_usages` or `skill_refs`, query the Stigmer
platform for resources that actually exist.

**Always run these discovery steps first:**

1. **Search for relevant MCP servers:**
   Use the Stigmer MCP tool `search` (resource type `mcp_server`) with keywords
   that reflect the user's intent (e.g., "github", "slack", "database").

2. **Fetch full MCP server details:**
   For each promising result, call `get_mcp_server` (by slug) to retrieve the
   server's description, discovered tool names, and env var requirements.
   Tool names from `status.discovered_capabilities.tools[*].name` are the
   authoritative strings—copy them exactly.

3. **Search for relevant skills:**
   Use `search` (resource type `skill`) with domain keywords. Then call
   `get_skill` to read the skill's description and confirm it matches the
   user's needs.

> **Never guess slugs or tool names.** A nonexistent reference will fail at
> runtime. A wrong tool name in `enabled_tools` or `tool_approval_overrides`
> is silently ignored—no error, no approval applied. Always verify.

---

## Phase 2 — Clarify Intent

Ask targeted questions before drafting if **any** of these are unknown:

| Unknown | Question to ask |
|---|---|
| Agent's purpose | "What should this agent do? What tasks will it handle?" |
| Organization | "Which organization owns this agent? (e.g., `acme-corp`, `default`)" |
| Required MCP servers | "Does this agent need external tools? If so, which systems?" |
| Required skills | "Should this agent have specialized knowledge from a skill?" |
| Sub-agents needed | "Are there specialized sub-tasks this agent should delegate?" |
| Visibility | "Should this agent be public (marketplace) or private (org-only)?" |
| Env vars | "Does this agent or its MCP servers need credentials at runtime?" |

**Stop and ask** if a needed MCP server or skill does not exist on the
platform. Never silently insert placeholder slugs.

Batch your questions—ask the most critical ones together, then follow up if
needed. Do not ask for information already clear from context.

---

## Phase 3 — Draft the YAML

Construct the YAML from the canonical structure. Full field reference:
[references/field-reference.md](references/field-reference.md).
Complete examples: [references/examples.md](references/examples.md).

### Skeleton

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: <kebab-case-name>
  org: <organization-slug>           # omit to inherit from CLI context
  visibility: visibility_private     # or visibility_public for marketplace
  tags: []                           # optional
spec:
  description: "<1-2 sentence summary>"
  instructions: |
    <system prompt — minimum 10 characters>
  mcp_server_usages: []              # see field reference
  skill_refs: []                     # see field reference
  sub_agents: []                     # see field reference
  env_spec: {}                       # declare vars the agent or its MCP servers need
```

### Key authoring rules

- `instructions` minimum **10 characters** (proto enforced). Write a real system
  prompt—make it specific, actionable, and personality-defining.
- `spec.description` is strongly recommended. Agents without it render poorly
  in the UI and marketplace.
- Each MCP server slug must be **unique** within `mcp_server_usages`.
- `skill_refs` and `mcp_server_ref` always use lowercase string kinds (`skill`,
  `mcp_server`), never integers (`43`, `44`).
- `metadata.slug` auto-generates from `name` if omitted. Override only when
  you need a specific URL-friendly identifier.
- Omit `org` in references (`skill_refs`, `mcp_server_ref`) for same-org
  resources. Set `org` explicitly only for cross-org public resources.
- Declare `env_spec` for any env var the agent or its MCP servers need at
  runtime. Since 2026-03, auto-resolved credentials (`GITHUB_TOKEN`, etc.) are
  only injected if declared here.

### Sub-agent permission model

Sub-agents can **only** reference MCP servers listed in the parent's
`mcp_server_usages`. Their `enabled_tools` must be a **subset** of the
parent's enabled tools for that server—they can restrict, never expand.

Sub-agent `skill_refs` are **independent**: a sub-agent may reference any
skill, even skills the parent does not use.

---

## Phase 4 — Validate Before Presenting

Work through this checklist mentally before showing the final YAML:

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `Agent`
- [ ] `metadata.name` is present
- [ ] `spec.instructions` is ≥ 10 characters and meaningful
- [ ] `spec.description` is present and informative
- [ ] All `skill_refs` use `kind: skill` (not `kind: 43`)
- [ ] All `mcp_server_ref` use `kind: mcp_server` (not `kind: 44`)
- [ ] All slugs are lowercase alphanumeric + hyphens, start with a letter, ≤ 63 chars
- [ ] MCP server slugs are unique within `mcp_server_usages`
- [ ] `enabled_tools` tool names were copied exactly from `get_mcp_server` results
- [ ] `tool_approval_overrides` tool names were verified against discovered tools
- [ ] Sub-agent `mcp_access[*].mcp_server` matches a slug in the parent's `mcp_server_usages`
- [ ] Sub-agent `enabled_tools` are subsets of the parent's tools for each server
- [ ] Sub-agent `instructions` are ≥ 10 characters
- [ ] `status` is absent (never set by users)
- [ ] YAML uses `|` block scalar for multi-line `instructions`

If any check fails, fix the YAML before presenting it.

---

## Delivering the Result

Present the final YAML in a fenced code block. Follow with a brief summary:

1. What the agent does and who owns it
2. Which MCP servers and tools are wired up, and why
3. Which skills are referenced, and what knowledge they inject
4. Any sub-agents and their delegation purpose
5. Any env vars the user needs to configure in their AgentInstance
6. Next steps: `stigmer apply -f agent.yaml` → `stigmer run <name> "<prompt>"`

---

## Reference Files

Load these when you need full field tables, validation details, or examples:

- **[references/field-reference.md](references/field-reference.md)** — Complete field documentation for all YAML sections
- **[references/examples.md](references/examples.md)** — Ready-to-apply examples from minimal to full-featured
