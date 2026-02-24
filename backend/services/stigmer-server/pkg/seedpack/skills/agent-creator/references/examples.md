# Agent YAML Examples

Five annotated examples covering the full range of Agent configurations.

## Table of Contents
1. [Minimal agent](#1-minimal-agent)
2. [Agent with skills](#2-agent-with-skills)
3. [Agent with MCP servers and tool approvals](#3-agent-with-mcp-servers-and-tool-approvals)
4. [Agent with sub-agents](#4-agent-with-sub-agents)
5. [Full-featured production agent](#5-full-featured-production-agent)

---

## 1. Minimal Agent

The simplest valid Agent — only required fields.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A helpful conversational assistant for answering questions."
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
    When you are unsure, say so and suggest where the user might find more information.
```

**Notes:**
- `metadata.slug` is auto-generated as `simple-assistant`.
- No MCP servers, skills, or sub-agents needed.
- `instructions` comfortably exceeds the 10-character minimum.

---

## 2. Agent with Skills

An agent that draws on platform-verified skill references.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: Code Reviewer
  tags:
    - code-review
    - security
spec:
  description: "Reviews code changes for quality, security vulnerabilities, and best practices."
  instructions: |
    You are a senior code reviewer. When presented with code, you analyze it for:
    - Security vulnerabilities (injection, auth flaws, data exposure)
    - Performance anti-patterns
    - Code readability and maintainability
    - Adherence to company style guides

    Provide specific, actionable feedback with line references where possible.
    Prioritize issues by severity: critical, major, minor.
  skill_refs:
    - org: local
      kind: skill
      slug: code-review-best-practices
    - org: local
      kind: skill
      slug: company-style-guide
      version: stable        # pin to the "stable" tag
```

**Notes:**
- `kind: skill` — always lowercase.
- `version: stable` pins to a named tag; omitting it resolves to the latest version.
- Skill slugs were discovered via `search` / `get_skill` before writing.

---

## 3. Agent with MCP Servers and Tool Approvals

An agent that integrates external systems with fine-grained approval controls.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  labels:
    team: engineering
  tags:
    - github
    - automation
spec:
  description: "Assists with GitHub operations including code search, PR creation, and issue management."
  instructions: |
    You are a GitHub automation assistant. Help developers with:
    - Searching and reading code across repositories
    - Creating and reviewing pull requests
    - Managing issues and labels
    - Checking CI/CD pipeline status

    Always confirm the target repository before making changes.
    Never push directly to the main branch.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github                 # verified via get_mcp_server(org:"local", slug:"github")
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
        - create_issue
        - list_issues
      tool_approval_overrides:
        - tool_name: create_pull_request
          requires_approval: true
          message: "Create PR in {{args.repo}}: {{args.title}}"
        - tool_name: create_issue
          requires_approval: false    # trust this agent for issue creation
```

**Notes:**
- Each slug in `mcp_server_usages` must be **unique** — only one entry per MCP server.
- `kind: mcp_server` — always lowercase.
- `tool_name` values must **exactly match** tool names the MCP server exposes.
- `enabled_tools` restricts which tools this agent can invoke; empty = all default tools.
- `tool_approval_overrides` customizes approval per-agent, overriding McpServer defaults.

---

## 4. Agent with Sub-Agents

A coordinator agent that delegates to specialized sub-agents.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-coordinator
spec:
  description: "Coordinates engineering tasks by delegating to specialized code-review and PR-creation sub-agents."
  instructions: |
    You coordinate engineering work. Analyze incoming requests and delegate:
    - Code quality concerns → code-reviewer sub-agent
    - Creating or updating pull requests → pr-creator sub-agent
    - General GitHub lookups → handle directly

    Synthesize sub-agent results into a coherent response for the user.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
        - list_pull_requests

  sub_agents:
    - name: code-reviewer
      description: "Performs deep code review for quality and security issues."
      instructions: |
        You are a focused code reviewer. Read the specified files and return
        a structured review covering security issues, logic errors, and
        style violations. Be specific and cite line numbers where possible.
      mcp_access:
        - mcp_server: github               # must match slug in parent's mcp_server_usages
          enabled_tools:
            - search_code                  # subset of parent's enabled_tools
            - get_file_contents
      skill_refs:
        - org: local
          kind: skill
          slug: code-review-best-practices  # sub-agent skills are independent of parent

    - name: pr-creator
      description: "Creates well-structured pull requests with clear descriptions."
      instructions: |
        You create pull requests. Given a summary of changes, produce a PR with:
        - A concise, imperative title (≤72 chars)
        - A description covering what changed and why
        - Links to relevant issues
        Always verify the base branch before creating the PR.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - create_pull_request          # only needs this one tool
            - get_file_contents
```

**Notes:**
- `sub_agents[].mcp_access[].mcp_server` must match a slug from `mcp_server_usages`.
- Sub-agent `enabled_tools` is a **subset** of the parent's enabled tools for that server.
  (`pr-creator` only gets `create_pull_request` + `get_file_contents`, not `search_code`.)
- Sub-agent `skill_refs` are independent — they can reference any platform skill.
- Sub-agent names (`code-reviewer`, `pr-creator`) must be unique within `sub_agents`.

---

## 5. Full-Featured Production Agent

All features combined: MCP servers, tool approvals, skills, sub-agents, env vars, labels, tags.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-assistant
  labels:
    team: devops
    environment: production
  tags:
    - deployment
    - kubernetes
    - automation
spec:
  description: "Automates production deployment workflows with safe approval gates and health monitoring."
  icon_url: "https://example.com/icons/deploy.svg"
  instructions: |
    You are a deployment automation assistant for production environments.

    Responsibilities:
    - Review deployment configurations for correctness and safety
    - Execute deployments after user approval
    - Monitor deployment health post-rollout
    - Initiate rollbacks automatically on health check failure

    Rules:
    - Always confirm the target environment (staging vs production) before proceeding.
    - Never skip approval gates for production deployments.
    - If a health check fails within 5 minutes of deployment, trigger rollback immediately.
    - Log all actions to the audit channel.

  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_application
        - rollback_deployment
        - get_pod_status
        - get_deployment_logs
      tool_approval_overrides:
        - tool_name: deploy_application
          requires_approval: true
          message: "Deploy {{args.app_name}} v{{args.version}} → {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: false    # allow automated rollback without manual gate

  skill_refs:
    - org: local
      kind: skill
      slug: kubernetes-best-practices
    - org: local
      kind: skill
      slug: company-deployment-runbook
      version: stable

  env_spec:
    data:
      KUBERNETES_CLUSTER_URL:
        description: "Target Kubernetes API server URL"
        is_secret: false
      KUBERNETES_TOKEN:
        description: "Service account token for Kubernetes API access"
        is_secret: true
      SLACK_AUDIT_WEBHOOK:
        description: "Slack webhook URL for deployment audit notifications"
        is_secret: true

  sub_agents:
    - name: health-monitor
      description: "Monitors deployment health after rollout and triggers rollback if needed."
      instructions: |
        You monitor Kubernetes deployments after rollout. Poll pod status every 30 seconds
        for 5 minutes. If any pod enters CrashLoopBackOff or the ready count drops below
        the desired count, report UNHEALTHY immediately so the parent can trigger rollback.
        Report HEALTHY only after 5 consecutive clean polls.
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:
            - get_pod_status           # read-only subset; cannot deploy or rollback
            - get_deployment_logs
```

**Notes:**
- Two distinct MCP servers (`github`, `kubernetes`) each with unique slugs.
- `kubernetes` tools include a `requires_approval: false` override (automated rollback).
- `env_spec` documents secrets — actual values injected via AgentInstance at runtime.
- `health-monitor` sub-agent gets a read-only subset of the `kubernetes` tools.
- `status` is completely absent — it is system-managed and must never be authored.
