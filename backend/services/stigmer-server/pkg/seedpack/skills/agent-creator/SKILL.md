---
name: agent-creator
description: >
  Creates valid, production-quality Stigmer Agent YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill whenever a user wants to create,
  scaffold, update, or review an Agent YAML for the Stigmer platform — including
  agents that use MCP servers, skills, sub-agents, environment variables, and
  tool approval policies. Also use when the user asks to "build an agent",
  "create an agent config", "write agent YAML", or anything that produces a
  Stigmer Agent resource definition.
---

# Agent Creator

This skill produces valid `agentic.stigmer.ai/v1` Agent YAML files. Follow the
workflow below **in order** for every agent creation request. Never skip the
resource-query step or the validation checklist.

---

## Workflow

### Step 1 — Gather Intent

Ask targeted questions to understand the agent's purpose. If the user's request is
ambiguous, pause and ask before proceeding. Minimum information needed:

- **What does this agent do?** (role, domain, primary task)
- **Does it need external tools?** (GitHub, Slack, databases, etc.)
- **Does it need specialized knowledge?** (skills / domain guides)
- **Should it delegate subtasks?** (sub-agents)
- **Any environment variables required?** (API keys, URLs)

Avoid asking more than 3–4 questions at once. Follow up as answers reveal new gaps.

---

### Step 2 — Query Available Resources (REQUIRED)

> **Never invent resource references.** All `mcp_server_usages` and `skill_refs`
> must be verified against real platform data before being written into YAML.

Use the Stigmer MCP server (`slug: stigmer-mcp-server`) to discover real resources:

```
# Broad keyword search (returns agents, skills, MCP servers, workflows)
search(query: "<domain keyword>")

# Targeted MCP server lookup
get_mcp_server(org: "local", slug: "<expected-slug>")

# Targeted skill lookup
get_skill(org: "local", slug: "<expected-slug>")
```

**Decision tree after querying:**

| Situation | Action |
|---|---|
| Resource found with correct tools/description | Reference it — use the exact `org` and `slug` returned |
| Resource not found, but user described a clear need | **Ask the user** whether to create the resource first or proceed without it |
| Tool name uncertain | Use `get_mcp_server` to inspect the server's `default_enabled_tools` and actual tool list |
| Multiple matches returned | Present options to the user and confirm which to use |

---

### Step 3 — Draft the YAML

Use the schema below to construct the YAML. Read `references/schema.md` for
complete field documentation and `references/examples.md` for annotated examples.

**Top-level skeleton:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: <human-readable name>
  # slug: auto-generated from name — only set if you need a specific URL identifier
  # labels: {}     # optional key-value pairs
  # tags: []       # optional string array
spec:
  description: "<1–2 sentence summary>"
  # icon_url: "https://..."    # optional
  instructions: |
    <system prompt — minimum 10 characters, should be meaningful>
  # mcp_server_usages: []   # omit if not needed
  # skill_refs: []          # omit if not needed
  # sub_agents: []          # omit if not needed
  # env_spec: {}            # omit if not needed
```

**Key construction rules (memorise these):**

1. `apiVersion` must be exactly `agentic.stigmer.ai/v1`
2. `kind` must be exactly `Agent`
3. `spec.instructions` must be ≥ 10 characters
4. Every `mcp_server_ref` must have `kind: mcp_server`
5. Every `skill_ref` entry must have `kind: skill`
6. MCP server slugs must be **unique** within `mcp_server_usages`
7. Sub-agent `mcp_access` may only reference slugs present in the **parent's** `mcp_server_usages`
8. Sub-agent `enabled_tools` must be a **subset** of the parent's `enabled_tools` for that server
9. Sub-agent `name` values must be **unique** within `sub_agents`
10. Slugs are lowercase alphanumeric + hyphens, start with a letter, 1–63 chars

See `references/validation.md` for the full checklist with pass/fail examples.

---

### Step 4 — Validate Before Presenting

Run through the validation checklist in `references/validation.md` before
delivering the final YAML. Fix any issues silently, then present clean output.

If a validation issue cannot be resolved (e.g., a required resource doesn't exist
on the platform), surface it to the user explicitly rather than guessing.

---

### Step 5 — Present and Explain

Deliver the YAML in a fenced code block. Follow it with a brief explanation:

- What the agent does
- Which MCP servers and skills are referenced (and why)
- Any sub-agents and their delegation purpose
- Any environment variables the user must provide at runtime
- CLI command to apply it:
  ```bash
  stigmer agent apply agent.yaml
  # Dry-run first:
  stigmer agent apply agent.yaml --dry-run
  ```

---

## Quick Reference

### ApiResourceReference formats

```yaml
# MCP server reference
mcp_server_ref:
  org: local
  kind: mcp_server
  slug: <mcp-server-slug>

# Skill reference
skill_refs:
  - org: local
    kind: skill
    slug: <skill-slug>
    # version: stable   # optional — omit to get latest
```

### MCP server usage (with optional tool approval)

```yaml
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
    enabled_tools:
      - search_code
      - get_file
    tool_approval_overrides:
      - tool_name: delete_repository
        requires_approval: true
        message: "Delete repository: {{args.repo_name}}"
```

### Sub-agent with restricted MCP access

```yaml
sub_agents:
  - name: code-reviewer          # unique within sub_agents
    description: "Reviews PRs for quality and security"
    instructions: |
      You review pull requests. Focus on security, performance, and style.
    mcp_access:
      - mcp_server: github       # must match a slug in parent's mcp_server_usages
        enabled_tools:           # must be subset of parent's enabled_tools
          - search_code
          - get_file
    skill_refs:
      - org: local
        kind: skill
        slug: code-review-guide
```

### Environment spec

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

---

## Reference Files

- **`references/schema.md`** — Complete field-by-field schema for every YAML section
- **`references/validation.md`** — Full validation checklist with pass/fail examples
- **`references/examples.md`** — Annotated Agent YAML examples (minimal to full-featured)

Load a reference file when you need depth beyond what's in this guide.
