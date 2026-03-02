# Agent YAML Examples

Annotated examples from minimal to full-featured. All slugs shown are
illustrative — always confirm real slugs via `get_mcp_server` / `get_skill`
before using them in actual output.

---

## Table of Contents

1. [Minimal agent](#1-minimal-agent)
2. [Agent with skill references](#2-agent-with-skill-references)
3. [Agent with MCP servers and tool selection](#3-agent-with-mcp-servers-and-tool-selection)
4. [Agent with tool approval overrides (HITL)](#4-agent-with-tool-approval-overrides-hitl)
5. [Agent with sub-agents](#5-agent-with-sub-agents)
6. [Full-featured agent (local mode)](#6-full-featured-agent-local-mode)
7. [Cloud / public marketplace agent](#7-cloud--public-marketplace-agent)
8. [Agent with environment variables](#8-agent-with-environment-variables)

---

## 1. Minimal Agent

The smallest valid Agent: metadata, description, and instructions only.
Suitable for a conversational assistant that needs no external tools.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
  org: local
spec:
  description: "A helpful assistant that answers questions clearly and concisely."
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
    When unsure, say so and offer to research further.
```

**Key points:**
- `org: local` — local development mode
- `instructions` exceeds 10-character minimum ✓
- No `status` field ✓
- `description` provides meaningful UI display ✓

---

## 2. Agent with Skill References

An agent augmented with domain knowledge packages. Skills inject their
`SKILL.md` content into the agent's context at runtime.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: local
  tags:
    - code-review
    - security
spec:
  description: "Reviews code for best practices, security vulnerabilities, and performance issues."
  instructions: |
    You are a code review assistant. For every review:
    1. Check for security vulnerabilities (injection, auth issues, secrets in code)
    2. Evaluate code quality and adherence to style guides
    3. Identify performance bottlenecks
    4. Suggest specific, actionable improvements with line references
  skill_refs:
    - org: local
      kind: skill           # lowercase string, never 43
      slug: code-analysis
    - org: local
      kind: skill
      slug: security-checklist
      version: stable       # pinned to mutable "stable" tag
```

**Key points:**
- `kind: skill` — always lowercase string ✓
- `version: stable` — pinned to a named tag for reproducibility
- Both slugs must be confirmed with `get_skill` before use
- Sub-agent skill refs are independent of parent — can reference any skill

---

## 3. Agent with MCP Servers and Tool Selection

An agent that acts on external systems via MCP server tools. `enabled_tools`
restricts to only what this agent needs (principle of least privilege).

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  org: local
  labels:
    team: engineering
spec:
  description: "Assists with GitHub operations: code search, PR creation, and issue management."
  instructions: |
    You help developers with GitHub tasks. You can search code,
    read files, create pull requests, and open issues.

    Always search for existing issues before creating new ones.
    Always get and review the relevant files before creating a PR.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server    # lowercase string, never 44
        slug: github        # confirm with get_mcp_server(slug="github")
      enabled_tools:
        - search_code       # exact tool names from server's tools/list
        - get_file
        - create_pr
        - create_issue
        - list_issues
```

**Key points:**
- `kind: mcp_server` — always lowercase string ✓
- Each `slug` must be confirmed via `get_mcp_server` before use
- Tool names are exact strings from the server's `tools/list`
- Empty `enabled_tools` = use server's `default_enabled_tools` (or all tools)
- One entry per server — if you need two servers, add two entries

---

## 4. Agent with Tool Approval Overrides (HITL)

Demonstrates human-in-the-loop gates on sensitive tool calls.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-bot
  org: local
spec:
  description: "Automates deployment workflows with mandatory human approval for production changes."
  instructions: |
    You are a deployment assistant. Help teams deploy applications safely.
    Always verify the target environment before executing any changes.
    Prefer rollbacks over retries when a deployment fails.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_app
        - rollback_deployment
        - get_pod_status
        - get_logs
      tool_approval_overrides:
        # Require approval for production deployments
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}}"

        # Trust automated rollbacks — no approval needed
        - tool_name: rollback_deployment
          requires_approval: false

        # Read-only tools need no override (no approval by default)
```

**Key points:**
- `tool_name` values must be exact, case-sensitive matches to `tools/list`
- A typo silently disables the approval policy — **no error is raised**
- `requires_approval: false` can override a McpServer-level default approval
- `message` supports `{{args.field}}` placeholders resolved at runtime
- Read-only tools typically need no override

---

## 5. Agent with Sub-Agents

A coordinator that delegates to specialized sub-agents. Sub-agents are
defined inline within the parent — they are not separate resources.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-coordinator
  org: local
spec:
  description: "Coordinates engineering tasks by delegating to specialized sub-agents."
  instructions: |
    You coordinate engineering work. Route tasks to sub-agents:
    - Code quality reviews → code-reviewer
    - Pull request creation → pr-creator
    Handle general questions directly without delegating.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
        - create_review_comment

  sub_agents:
    - name: code-reviewer                    # unique within sub_agents
      description: "Reviews code for quality, security, and best practices."
      instructions: |
        You review code changes thoroughly. For each file:
        - Check for security vulnerabilities and injection risks
        - Evaluate code quality and naming conventions
        - Note performance concerns
        Use search_code to explore related code for context.
      mcp_access:
        - mcp_server: github                 # slug from parent's mcp_server_usages
          enabled_tools:
            - search_code                    # subset of parent's [search_code, get_file, create_pr, create_review_comment]
            - get_file
            - create_review_comment
      skill_refs:                            # independent of parent's skills
        - org: local
          kind: skill
          slug: security-checklist

    - name: pr-creator
      description: "Creates well-formatted pull requests with clear descriptions."
      instructions: |
        You create pull requests. Always read the changed files first,
        then write a clear title and description summarizing the change,
        its motivation, and any testing notes.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - get_file
            - create_pr             # only create_pr and get_file — not search or comments
```

**Key points:**
- Parent's `instructions` explicitly name which sub-agents handle which tasks
- `mcp_access[*].mcp_server` values are slugs, not full refs
- Sub-agent `enabled_tools` are strict subsets of parent's grant
- `pr-creator` cannot use `search_code` or `create_review_comment` — not in its grant
- Sub-agent `skill_refs` are independent of parent's skills

---

## 6. Full-Featured Agent (Local Mode)

Combines all features: MCP servers, approval overrides, skills, sub-agents,
and environment variable schema.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-assistant
  org: local
  labels:
    team: devops
    environment: production
  tags:
    - deployment
    - automation
    - kubernetes
spec:
  description: "Automates deployment workflows with approval controls, health monitoring, and rollback capabilities."
  icon_url: "https://example.com/icons/deploy.svg"
  instructions: |
    You are a deployment automation assistant for Acme Corp.

    Responsibilities:
    - Review deployment configurations for correctness
    - Execute deployments to Kubernetes clusters
    - Monitor pod health after rollout
    - Initiate rollbacks on failures

    Rules:
    - Always verify the target environment before deploying
    - Never deploy to production on Fridays
    - Require confirmation before any destructive operation

  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_app
        - rollback_deployment
        - get_pod_status
        - get_logs
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}} cluster"
        - tool_name: rollback_deployment
          requires_approval: false

  skill_refs:
    - org: local
      kind: skill
      slug: kubernetes-runbook
    - org: local
      kind: skill
      slug: deployment-procedures
      version: stable

  env_spec:
    data:
      KUBERNETES_CLUSTER:
        description: "Target Kubernetes cluster URL"
        is_secret: false
      SLACK_WEBHOOK:
        description: "Slack webhook for deployment notifications"
        is_secret: true

  sub_agents:
    - name: health-monitor
      description: "Monitors pod health and logs after deployment rollout."
      instructions: |
        You monitor deployment health. After a rollout:
        1. Check pod status until all pods are Running
        2. Tail logs for errors in the first 5 minutes
        3. Report any crash loops or OOMKills immediately
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:
            - get_pod_status   # read-only subset of parent's kubernetes tools
            - get_logs
```

---

## 7. Cloud / Public Marketplace Agent

An agent published to the Stigmer marketplace from a named organization.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: web-research-assistant
  org: acme-corp                    # real org slug, not "local"
  visibility: visibility_public     # marketplace publishing
  tags:
    - research
    - web-search
    - productivity
spec:
  description: "Searches the web and synthesizes findings into cited summaries for research tasks."
  icon_url: "https://acme-corp.example.com/icons/research.svg"
  instructions: |
    You are a research assistant. When users ask questions:
    1. Search the web for relevant, authoritative sources
    2. Read key pages for detail
    3. Synthesize findings into a clear, well-structured summary
    4. Always cite sources with URLs

    Acknowledge uncertainty when sources conflict.
  mcp_server_usages:
    - mcp_server_ref:
        org: acme-corp              # org must match where server is defined
        kind: mcp_server
        slug: web-search
      enabled_tools:
        - search
        - fetch_page
  skill_refs:
    - org: acme-corp
      kind: skill
      slug: research-methodology
      version: stable               # pinned for production reliability
```

**Key differences from local mode:**
- `metadata.org` is a real org slug (`acme-corp`), not `local`
- `metadata.visibility: visibility_public` enables marketplace listing
- Resource refs use the appropriate owning org
- Skills pin to `stable` for reproducibility in production

---

## 8. Agent with Environment Variables

When an agent's MCP servers or instructions need runtime configuration
(API URLs, tokens), declare the schema in `env_spec`. Values are provided
at runtime via AgentInstance — never embed secrets in the Agent YAML.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: database-analyst
  org: local
spec:
  description: "Analyzes database query performance and suggests optimizations."
  instructions: |
    You analyze SQL queries and database performance. You have access to
    a PostgreSQL database. When given a slow query, explain the execution
    plan, identify bottlenecks, and suggest optimized alternatives.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: postgres
      enabled_tools:
        - execute_query
        - explain_query
        - list_tables
      tool_approval_overrides:
        - tool_name: execute_query
          requires_approval: true
          message: "Execute SQL: {{args.query}}"
  env_spec:
    data:
      DATABASE_URL:
        description: "PostgreSQL connection string (host, port, database, user)"
        is_secret: false
      DATABASE_PASSWORD:
        description: "PostgreSQL user password"
        is_secret: true
      MAX_ROWS:
        description: "Maximum rows to return per query (default: 100)"
        is_secret: false
```

**Key points:**
- `env_spec.data` documents what the agent needs; actual values go in
  the AgentInstance environment binding at runtime
- `is_secret: true` → encrypted at rest, redacted in logs
- `is_secret: false` → plaintext, visible in audit logs
- Leave `value` empty in the Agent spec — not a place for secrets
