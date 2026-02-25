# Sub-Agent Guide

## Table of Contents
1. [When to Use Sub-Agents](#1-when-to-use-sub-agents)
2. [Permission Model](#2-permission-model)
3. [Full Sub-Agent Schema](#3-full-sub-agent-schema)
4. [Design Patterns](#4-design-patterns)
5. [Common Mistakes](#5-common-mistakes)

---

## 1. When to Use Sub-Agents

Recommend sub-agents when:
- The agent handles **distinct, specialized roles** (reviewer vs. writer vs. deployer)
- Different roles need **different tool access** (principle of least privilege)
- The user wants **clear delegation semantics** visible in the YAML
- Tasks are naturally sequential and hand-off work to one another

Do NOT use sub-agents when:
- The agent has a single, focused purpose (sub-agents would add unnecessary complexity)
- All tools should be equally accessible throughout the workflow
- The user hasn't requested a multi-agent structure

---

## 2. Permission Model

Sub-agents have **strictly constrained** access derived from the parent:

```
Parent mcp_server_usages
    └── Sub-agent mcp_access
            ├── mcp_server: must match a slug from parent's mcp_server_usages
            └── enabled_tools: must be a SUBSET of parent's enabled_tools for that server
```

**Key invariants:**
1. A sub-agent **cannot access** an MCP server not declared in the parent's `mcp_server_usages`
2. A sub-agent **cannot use** a tool that the parent hasn't enabled for that server
3. A sub-agent **can** have an empty `enabled_tools` → inherits all of parent's tools for that server
4. Sub-agent `skill_refs` are **fully independent** — they can reference any skill on the platform

**Example of the subset rule:**

```yaml
# Parent enables these tools on github:
mcp_server_usages:
  - mcp_server_ref:
      org: local
      kind: mcp_server
      slug: github
    enabled_tools:
      - search_code
      - get_file
      - create_pr
      - create_issue

# Sub-agent can only use a subset:
sub_agents:
  - name: code-reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools:
          - search_code    # ✅ in parent's list
          - get_file       # ✅ in parent's list
          # create_pr      # ❌ excluded (least-privilege: reviewer shouldn't create PRs)
          # create_issue   # ❌ excluded
```

---

## 3. Full Sub-Agent Schema

```yaml
sub_agents:
  - name: <unique-name>          # Required. Unique string within parent's sub_agents.
    description: "<text>"        # Optional but recommended. Helps parent route delegation.
    instructions: |              # Required. Min 10 characters.
      You are a specialized ...
    mcp_access:                  # Optional. Grants subsets of parent's MCP server access.
      - mcp_server: <slug>       # Required. Must match slug from parent's mcp_server_usages.
        enabled_tools:           # Optional. Subset of parent's enabled_tools. Empty = all.
          - tool_name_1
          - tool_name_2
    skill_refs:                  # Optional. Any platform skills (independent of parent).
      - org: local
        kind: skill
        slug: <verified-slug>
        version: <tag-or-hash>   # Optional.
```

---

## 4. Design Patterns

### Pattern A: Role Specialization

Split a broad agent into focused roles. Each role gets only the tools it needs.

```yaml
# Parent: Full DevOps assistant
mcp_server_usages:
  - mcp_server_ref: {org: local, kind: mcp_server, slug: github}
    enabled_tools: [search_code, get_file, create_pr, create_issue, merge_pr, delete_branch]
  - mcp_server_ref: {org: local, kind: mcp_server, slug: kubernetes}
    enabled_tools: [get_pod_status, deploy_app, rollback_deployment]

sub_agents:
  - name: code-reviewer
    description: "Reviews code changes for quality, security, and best practices"
    instructions: |
      You review code changes. Analyze diffs for bugs, security issues,
      performance problems, and style violations. Provide specific, actionable feedback.
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]  # Read-only subset

  - name: pr-manager
    description: "Creates and merges pull requests"
    instructions: |
      You manage pull requests. Create PRs with clear titles and descriptions,
      ensure CI is green, and merge when approved.
    mcp_access:
      - mcp_server: github
        enabled_tools: [create_pr, merge_pr, delete_branch, get_file]

  - name: deployer
    description: "Deploys applications to Kubernetes"
    instructions: |
      You deploy applications to Kubernetes clusters. Verify deployment configs
      before applying. Monitor rollouts and rollback on failure.
    mcp_access:
      - mcp_server: kubernetes
        # enabled_tools omitted: inherits all parent kubernetes tools
```

### Pattern B: Research + Action Split

Separate information gathering from write operations.

```yaml
sub_agents:
  - name: researcher
    description: "Gathers information and analyzes options without making changes"
    instructions: |
      You research and analyze. Gather facts, compare options, and synthesize
      findings. Never write, delete, or modify anything.
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]

  - name: executor
    description: "Implements changes based on the researcher's findings"
    instructions: |
      You implement changes based on provided analysis. Create files, open PRs,
      and make modifications as directed.
    mcp_access:
      - mcp_server: github
        enabled_tools: [create_pr, create_issue, get_file]
```

### Pattern C: Skills-Only Sub-Agent

A sub-agent that uses specialized knowledge but no external tools.

```yaml
sub_agents:
  - name: sql-writer
    description: "Writes optimized SQL queries based on user requirements"
    instructions: |
      You write efficient, well-formatted SQL queries. Follow the company's
      SQL style guide and optimization best practices.
    # No mcp_access needed
    skill_refs:
      - org: local
        kind: skill
        slug: sql-style-guide
      - org: local
        kind: skill
        slug: database-schema
```

---

## 5. Common Mistakes

**Sub-agent references a non-parent MCP server:**
```yaml
# ❌ Wrong: parent has no "slack" in mcp_server_usages
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: slack   # Not in parent's list → validation error

# ✅ Correct: add slack to parent first, then grant to sub-agent
mcp_server_usages:
  - mcp_server_ref: {org: local, kind: mcp_server, slug: slack}
    enabled_tools: [post_message]
sub_agents:
  - name: notifier
    mcp_access:
      - mcp_server: slack
        enabled_tools: [post_message]
```

**Sub-agent expands parent's tool set:**
```yaml
# Parent enables only: [search_code, get_file]
# ❌ Wrong: sub-agent adds a tool the parent doesn't have
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file, delete_repository]  # delete_repository not in parent!

# ✅ Correct: only use tools parent has enabled
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]
```

**Duplicate sub-agent names:**
```yaml
# ❌ Wrong
sub_agents:
  - name: helper
    instructions: "You help with writing."
  - name: helper      # Duplicate!
    instructions: "You help with research."

# ✅ Correct: unique names
sub_agents:
  - name: writing-helper
    instructions: "You help with writing."
  - name: research-helper
    instructions: "You help with research."
```
