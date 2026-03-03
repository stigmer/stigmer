# Sub-Agent Authoring Guide

## Table of Contents
1. [When to Use Sub-Agents](#1-when-to-use-sub-agents)
2. [Permission Model](#2-permission-model)
3. [Defining Sub-Agents](#3-defining-sub-agents)
4. [mcp_access Rules](#4-mcp_access-rules)
5. [Delegation Routing via Instructions](#5-delegation-routing-via-instructions)
6. [Common Mistakes](#6-common-mistakes)

---

## 1. When to Use Sub-Agents

Add sub-agents when:
- The parent agent has **distinct specializations** that benefit from separate system prompts
- You want to give different workers **different tool subsets** (e.g., a reader vs a writer)
- The parent needs to **orchestrate** rather than do all work itself

Do NOT add sub-agents for:
- Simple single-purpose agents (one job, one set of tools)
- Tasks where the parent can handle complexity in its own instructions

---

## 2. Permission Model

Sub-agents are strictly bounded by their parent. This invariant is enforced at runtime:

```
Parent
├── mcp_server_usages: github (tools: search_code, create_pr, get_file, delete_repo)
│
├── Sub-Agent A: mcp_access github → enabled_tools: [search_code, get_file]    ✓ subset
├── Sub-Agent B: mcp_access github → enabled_tools: [create_pr, get_file]      ✓ subset
└── Sub-Agent C: mcp_access github → enabled_tools: [delete_repo, merge_pr]    ✗ merge_pr not in parent
```

Rules:
1. Sub-agent `mcp_access[*].mcp_server` must match a `slug` from parent's `mcp_server_usages`
2. Sub-agent `enabled_tools` must be a **subset** of parent's `enabled_tools` for that server
3. An empty `enabled_tools` in a sub-agent means "all tools the parent has" (still bounded)
4. If a sub-agent has no `mcp_access` entries, it has **no MCP server access**
5. Sub-agent `skill_refs` are **independent** — they can reference any skill, including
   skills the parent doesn't have

---

## 3. Defining Sub-Agents

```yaml
sub_agents:
  - name: <kebab-case>          # required; unique within parent; used for routing/logging
    description: "<delegation trigger>"  # what causes the parent to delegate here
    instructions: |             # required; min 10 chars; sub-agent's system prompt
      <focused behavioral guidance>
    mcp_access:                 # which of the parent's MCP servers this sub-agent can use
      - mcp_server: <slug>      # slug only — no kind/org here
        enabled_tools:
          - <tool>
    skill_refs:                 # optional; independent of parent's skill_refs
      - kind: skill
        slug: <slug>
```

Sub-agent `name` recommendations:
- Use a role-based name: `code-reviewer`, `researcher`, `writer`, `health-checker`
- Must be unique within the parent agent's `sub_agents` list
- Kebab-case by convention (not enforced, but consistent with slugs)

---

## 4. mcp_access Rules

`McpAccess.mcp_server` is a **slug string**, not a full `ApiResourceReference`:

```yaml
# Correct — slug only
mcp_access:
  - mcp_server: github

# Wrong — do not use kind/org here
mcp_access:
  - mcp_server:
      kind: mcp_server
      slug: github
```

The slug must exactly match the `mcp_server_ref.slug` from the parent's `mcp_server_usages`:

```yaml
# Parent declares:
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: github          # <-- slug is "github"

# Sub-agent references with this slug:
mcp_access:
  - mcp_server: github      # ✓ matches parent slug
  - mcp_server: gh          # ✗ "gh" not in parent's mcp_server_usages
```

---

## 5. Delegation Routing via Instructions

The parent agent uses sub-agent `name` and `description` to decide when to delegate.
Write descriptions that clearly trigger the right delegation:

```yaml
# Good — precise trigger condition
description: "Reviews code diffs for security vulnerabilities and style violations. Triggered when reviewing PRs."

# Poor — parent cannot route accurately
description: "Handles code stuff"
```

The parent's `instructions` should describe the delegation strategy:

```yaml
instructions: |
  You coordinate platform work. Delegate based on task type:
  - All pod health checks → health-checker
  - Infrastructure code reviews → code-reviewer
  Handle deployment decisions and communication yourself.
```

---

## 6. Common Mistakes

### Sub-agent tool not in parent's enabled_tools

```yaml
# Parent enables: [search_code, get_file, create_pr]
sub_agents:
  - name: merger
    mcp_access:
      - mcp_server: github
        enabled_tools:
          - merge_pr    # ✗ parent does NOT have merge_pr
```

**Fix**: Add `merge_pr` to the parent's `enabled_tools`, or remove it from the sub-agent.

### Using mcp_server ref syntax instead of slug string

```yaml
# Wrong
mcp_access:
  - mcp_server:
      kind: mcp_server
      slug: github

# Correct
mcp_access:
  - mcp_server: github
```

### Sub-agent referencing an MCP server not in parent

```yaml
# Parent has: github, kubernetes
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: slack   # ✗ parent has no "slack" in mcp_server_usages
```

**Fix**: Add `slack` to the parent's `mcp_server_usages`, or remove the sub-agent's
`mcp_access` entry for it.

### Non-unique sub-agent names

```yaml
sub_agents:
  - name: reviewer
    ...
  - name: reviewer    # ✗ duplicate name within parent
    ...
```

Each sub-agent `name` must be unique within the parent's `sub_agents` list.
