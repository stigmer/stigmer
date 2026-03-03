# Agent YAML Examples

Complete, annotated examples. All are valid and can be applied with `stigmer apply -f`.

## Table of Contents
1. [Minimal Agent](#1-minimal-agent)
2. [Agent with Skills](#2-agent-with-skills)
3. [Agent with MCP Servers](#3-agent-with-mcp-servers)
4. [Agent with HITL Approval](#4-agent-with-hitl-approval)
5. [Agent with Sub-Agents](#5-agent-with-sub-agents)
6. [Full-Featured Agent](#6-full-featured-agent)
7. [Public Marketplace Agent](#7-public-marketplace-agent)

---

## 1. Minimal Agent

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
  org: default
spec:
  description: "A helpful assistant that answers questions clearly and concisely."
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
    When you are unsure, say so rather than guessing.
```

**Notes**: `org: default` is the auto-created org on a local server. Omit `org` if
running inside a Stigmer project (`stigmer apply -f`).

---

## 2. Agent with Skills

Skills provide injected domain knowledge. References are relative (no `org` =
resolved from `metadata.org`).

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: acme-corp
  tags:
    - code-review
    - security
spec:
  description: "Reviews code for quality, security vulnerabilities, and best practices."
  instructions: |
    You are a code review assistant for Acme Corp.
    For every review:
    1. Check for security vulnerabilities (injection, auth, secrets in code)
    2. Evaluate code quality and adherence to the company style guide
    3. Identify performance bottlenecks
    4. Suggest specific, actionable improvements with code examples
  skill_refs:
    - kind: skill
      slug: code-analysis        # discovered via: get_skill(org="acme-corp", slug="code-analysis")
    - kind: skill
      slug: company-style-guide
      version: stable            # pin to stable tag for reproducible behavior
```

---

## 3. Agent with MCP Servers

Tool names come from `status.discovered_capabilities.tools[*].name` on the
McpServer resource. Empty `enabled_tools` inherits the server's defaults.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  org: acme-corp
  labels:
    team: engineering
spec:
  description: "Assists with GitHub operations: code search, PR management, and issue tracking."
  instructions: |
    You help developers with GitHub tasks.
    - Search for code patterns across repositories using search_code
    - Create pull requests with clear titles, descriptions, and linked issues
    - Manage issues: create, label, and close them
    Always confirm the target repository before taking any action.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github              # discovered via: get_mcp_server(org="acme-corp", slug="github")
      enabled_tools:              # only what this agent actually needs
        - search_code
        - create_pr
        - get_file
        - create_issue
        - close_issue
```

---

## 4. Agent with HITL Approval

Add approval checkpoints for destructive or sensitive actions.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-bot
  org: acme-corp
  labels:
    team: devops
spec:
  description: "Deploys applications to Kubernetes with human approval for production changes."
  instructions: |
    You automate Kubernetes deployments for Acme Corp.
    Always verify the target environment (staging vs production) before any deploy.
    Require explicit user confirmation before deploying to production.
    After every deployment, monitor pod status and report success or failure.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_app
        - rollback_deployment
        - get_pod_status
        - scale_deployment
      tool_approval_overrides:
        - tool_name: deploy_app              # exact name from discovered_capabilities
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}}"
        - tool_name: scale_deployment
          requires_approval: true
          message: "Scale {{args.app_name}} to {{args.replicas}} replicas in {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: false           # trusted — always safe to roll back
```

---

## 5. Agent with Sub-Agents

Sub-agents must only use tools the parent already has. Names are unique within the parent.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-lead
  org: acme-corp
spec:
  description: "Coordinates engineering tasks by delegating to specialized sub-agents."
  instructions: |
    You coordinate engineering work. Use sub-agents for specialized tasks:
    - Delegate code reviews to the code-reviewer sub-agent
    - Delegate PR creation to the pr-creator sub-agent
    Handle questions about architecture or process yourself.
    Always summarize sub-agent results before presenting to the user.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code     # available to parent and any sub-agent that requests it
        - create_pr       # parent has this; sub-agents can selectively request it
        - get_file
        - create_issue
  sub_agents:
    - name: code-reviewer
      description: "Reviews code diffs for quality, security, and style. Triggered on review requests."
      instructions: |
        You review code changes. Focus on:
        - Security vulnerabilities (injections, auth flaws, exposed secrets)
        - Code quality and performance
        - Adherence to company standards
        Provide specific, line-level feedback with actionable suggestions.
      mcp_access:
        - mcp_server: github           # slug only; must be in parent's mcp_server_usages
          enabled_tools:               # strict subset of parent's tools for this server
            - search_code
            - get_file
      skill_refs:                      # sub-agent skills are independent of parent
        - kind: skill
          slug: security-checklist

    - name: pr-creator
      description: "Creates pull requests with clear titles and descriptions. Triggered when code is ready."
      instructions: |
        You create pull requests. Always include:
        - A concise title (imperative mood, ≤ 72 chars)
        - A description with: what changed, why, and how to test
        - Links to related issues
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - create_pr
            - get_file
```

---

## 6. Full-Featured Agent

All capabilities combined: MCP servers, approvals, skills, sub-agents, env_spec.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: platform-engineer
  org: acme-corp
  labels:
    team: platform
    environment: production
  tags:
    - deployment
    - kubernetes
    - automation
spec:
  description: "Automates platform engineering tasks with approval controls and specialized sub-agents."
  icon_url: "https://cdn.acme-corp.com/icons/platform-bot.svg"
  instructions: |
    You are the platform engineering assistant for Acme Corp.
    You manage infrastructure, deployments, and incident response.

    Responsibilities:
    - Deploy and scale applications on Kubernetes
    - Review infrastructure changes for safety
    - Respond to incidents with rollbacks and scaling
    - Report all actions to Slack

    Delegation:
    - Health monitoring → health-checker sub-agent
    - Code analysis before deployments → code-reviewer sub-agent
    Handle coordination and decision-making yourself.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_app
        - rollback_deployment
        - get_pod_status
        - scale_deployment
        - get_logs
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} v{{args.version}} → {{args.environment}}"
        - tool_name: scale_deployment
          requires_approval: true
          message: "Scale {{args.app_name}}: {{args.current_replicas}} → {{args.replicas}}"
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_issue
    - mcp_server_ref:
        kind: mcp_server
        slug: slack
      enabled_tools:
        - send_message
  skill_refs:
    - kind: skill
      slug: kubernetes-runbook
      version: stable
    - kind: skill
      slug: incident-response-playbook
  env_spec:
    data:
      K8S_CLUSTER_URL:
        description: "Kubernetes API server URL"
        is_secret: false
      SLACK_CHANNEL:
        description: "Default Slack channel for notifications"
        is_secret: false
      PAGERDUTY_TOKEN:
        description: "PagerDuty API token for incident creation"
        is_secret: true
  sub_agents:
    - name: health-checker
      description: "Monitors pod health and logs after deployments. Triggered automatically post-deploy."
      instructions: |
        You monitor Kubernetes deployments after rollout.
        Check pod status, recent logs, and readiness probes.
        Report any CrashLoopBackOff, OOMKilled, or pending pods immediately.
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:
            - get_pod_status
            - get_logs

    - name: code-reviewer
      description: "Reviews infrastructure code (Helm charts, Dockerfiles) for security issues."
      instructions: |
        You review infrastructure-as-code changes.
        Focus on: exposed secrets, overly permissive RBAC, insecure base images,
        missing resource limits, and compliance with Acme Corp infra standards.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
      skill_refs:
        - kind: skill
          slug: infrastructure-security-checklist
```

---

## 7. Public Marketplace Agent

Published to the marketplace; uses explicit `org` in all references.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: research-assistant
  org: acme-corp
  visibility: visibility_public    # marketplace publishing
  labels:
    category: productivity
  tags:
    - research
    - web-search
    - summarization
spec:
  description: "Searches the web and synthesizes cited summaries for research tasks."
  icon_url: "https://cdn.acme-corp.com/icons/research.svg"
  instructions: |
    You are a research assistant. For every research request:
    1. Search the web for relevant, authoritative sources
    2. Read the most relevant pages in full
    3. Synthesize findings into a clear, structured summary
    4. Cite every claim with the source URL
    5. Note areas of uncertainty or conflicting information
  mcp_server_usages:
    - mcp_server_ref:
        org: acme-corp              # explicit org for marketplace agent
        kind: mcp_server
        slug: web-search
      enabled_tools:
        - search
        - fetch_page
  skill_refs:
    - org: acme-corp                # explicit org for marketplace agent
      kind: skill
      slug: research-methodology
      version: stable
```
