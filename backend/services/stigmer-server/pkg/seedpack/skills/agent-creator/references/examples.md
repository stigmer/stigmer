# Agent YAML Examples

Annotated examples ranging from minimal to fully-featured.
All examples conform to the `agentic.stigmer.ai/v1` API.

## Table of Contents

1. [Minimal Agent](#1-minimal-agent)
2. [Agent with Skills](#2-agent-with-skills)
3. [Agent with MCP Servers](#3-agent-with-mcp-servers)
4. [Agent with Tool Approval Controls](#4-agent-with-tool-approval-controls)
5. [Agent with Sub-Agents](#5-agent-with-sub-agents)
6. [Agent with Environment Variables](#6-agent-with-environment-variables)
7. [Full-Featured Agent](#7-full-featured-agent)

---

## 1. Minimal Agent

The smallest valid Agent YAML. Only the absolutely required fields.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A general-purpose conversational assistant."
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
    When uncertain, say so rather than guessing.
```

**Notes:**
- `metadata.slug` is auto-generated from the name → `simple-assistant`
- No MCP servers, skills, sub-agents, or env vars needed
- `instructions` is well over the 10-character minimum

---

## 2. Agent with Skills

Skills inject specialised knowledge into the agent's context at runtime.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  tags:
    - code-review
    - security
spec:
  description: "Reviews code for best practices, security vulnerabilities, and style."
  instructions: |
    You are a senior code reviewer. When given code or a pull request:
    1. Identify security vulnerabilities
    2. Flag performance issues
    3. Check for proper error handling
    4. Suggest style improvements aligned with team standards
    Provide specific, actionable feedback with line references where possible.
  skill_refs:
    - org: local
      kind: skill
      slug: code-review-best-practices
    - org: local
      kind: skill
      slug: company-style-guide
      version: stable          # pin to the 'stable' tag
```

**Notes:**
- `version: stable` pins to a mutable tag (update the tag to roll out new skill versions)
- Omit `version` to always resolve to latest
- Both skills were verified with `get_skill` before authoring

---

## 3. Agent with MCP Servers

Grants the agent access to external tools via MCP.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  labels:
    team: engineering
  tags:
    - github
    - code-management
spec:
  description: "Assists engineers with GitHub tasks: searching code, creating PRs, and managing issues."
  instructions: |
    You help developers with GitHub operations. You can:
    - Search the codebase for relevant files or patterns
    - Create well-formatted pull requests with clear descriptions
    - File and update GitHub issues
    Always confirm the target repository before making changes.
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
        - list_issues
```

**Notes:**
- `enabled_tools` was populated by inspecting `get_mcp_server(org: "local", slug: "github")`
- Omitting `enabled_tools` would use the McpServer's `default_enabled_tools`
- Tool names are case-sensitive and must match the MCP server's `tools/list` exactly

---

## 4. Agent with Tool Approval Controls

Customize which tools require human-in-the-loop approval.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: database-operator
spec:
  description: "Manages database operations with approval gates on destructive actions."
  instructions: |
    You assist database administrators with routine operations.
    Always read before you write. Require explicit confirmation for schema changes.
    Never execute DROP or DELETE without running a SELECT with the same WHERE clause first.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: postgres
      enabled_tools:
        - execute_query
        - list_tables
        - describe_table
        - execute_sql
        - drop_table
      tool_approval_overrides:
        # Add approval for queries (not set by McpServer default)
        - tool_name: execute_sql
          requires_approval: true
          message: "Execute SQL: {{args.query}}"

        # Require approval for DROP even if it's in the MCP default
        - tool_name: drop_table
          requires_approval: true
          message: "DROP TABLE {{args.table_name}} — this is irreversible"

        # Trusted read operation — disable any McpServer-level approval
        - tool_name: execute_query
          requires_approval: false
```

**Notes:**
- Approval chain: McpServer defaults → these overrides → `AgentExecution.auto_approve_all`
- `{{args.field}}` placeholders are resolved at runtime from the actual tool arguments
- `requires_approval: false` overrides even a McpServer-level approval default

---

## 5. Agent with Sub-Agents

Delegate specialised tasks to focused sub-agents.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-manager
spec:
  description: "Coordinates engineering tasks by delegating to specialised sub-agents for code review and PR creation."
  instructions: |
    You are an engineering coordinator. Analyse incoming requests and delegate:
    - Code quality reviews → code-reviewer sub-agent
    - Pull request creation → pr-creator sub-agent
    - Anything requiring both → sequence them in order
    Synthesise sub-agent outputs into a single coherent response.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
        - list_prs

  sub_agents:
    - name: code-reviewer
      description: "Reviews code for quality, security, and best practices."
      instructions: |
        You are a senior code reviewer. Examine the provided code or diff for:
        - Security vulnerabilities
        - Performance anti-patterns
        - Unhandled errors and edge cases
        Provide line-level feedback where applicable.
      mcp_access:
        - mcp_server: github          # must match parent's slug
          enabled_tools:              # subset of parent's [search_code, get_file, create_pr, list_prs]
            - search_code
            - get_file
      skill_refs:
        - org: local
          kind: skill
          slug: code-review-best-practices

    - name: pr-creator
      description: "Creates pull requests with clear titles, descriptions, and change summaries."
      instructions: |
        You create GitHub pull requests. Always include:
        - A descriptive title (max 72 chars)
        - A summary of what changed and why
        - A testing notes section
        Reference any related issues using GitHub's closing keywords.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - create_pr
            - get_file
            - list_prs
```

**Notes:**
- Sub-agent `mcp_server` values (`github`) must match slugs in the parent's `mcp_server_usages`
- Sub-agent `enabled_tools` must be subsets of the parent's `[search_code, get_file, create_pr, list_prs]`
- Sub-agent names (`code-reviewer`, `pr-creator`) are unique — this is validated
- Sub-agent `skill_refs` are independent — `pr-creator` has no skills, which is fine

---

## 6. Agent with Environment Variables

Declare required runtime configuration. Values are injected via `AgentInstance`.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: slack-notifier
spec:
  description: "Sends structured Slack notifications for deployment and incident events."
  instructions: |
    You send Slack notifications for system events. Format messages clearly:
    - Deployments: include app name, environment, version, and deployer
    - Incidents: include severity, affected service, and status
    - Always mention the relevant on-call channel for P1/P2 incidents
    Use the SLACK_DEFAULT_CHANNEL env var as the fallback channel.
  env_spec:
    data:
      SLACK_WEBHOOK_URL:
        description: "Incoming webhook URL for posting messages"
        is_secret: true
      SLACK_DEFAULT_CHANNEL:
        description: "Default channel slug (e.g., #deployments)"
        is_secret: false
      SLACK_BOT_TOKEN:
        description: "Bot token for Slack API calls requiring auth"
        is_secret: true
```

**Notes:**
- `is_secret: true` encrypts at rest and redacts in logs
- `value` is intentionally omitted — populated at runtime by the `AgentInstance`'s environment
- Variable names are uppercase by convention (no enforced format)

---

## 7. Full-Featured Agent

Combines all features: MCP servers with approval controls, skills, sub-agents, and env vars.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-platform
  labels:
    team: platform
    environment: production
  tags:
    - deployment
    - kubernetes
    - automation
    - cicd
spec:
  description: "Automates production deployments on Kubernetes with approval gates and rollback capability."
  icon_url: "https://example.com/icons/rocket.svg"
  instructions: |
    You are a production deployment assistant. Your responsibilities:
    - Review deployment configurations before applying
    - Execute deployments to Kubernetes with appropriate approval gates
    - Monitor rollout health and trigger rollbacks on failure
    - Notify the engineering team via Slack for all deployments and incidents

    Guiding principles:
    - Always verify target namespace and cluster before deploying
    - Prefer rollback over troubleshooting for P1 production incidents
    - Never deploy to production without a corresponding PR in GitHub

  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
        - get_pr

    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_app
        - rollback_deployment
        - get_pod_status
        - list_deployments
        - scale_deployment
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} v{{args.version}} to {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: false    # Trust this agent to rollback without pause
        - tool_name: scale_deployment
          requires_approval: true
          message: "Scale {{args.deployment}} to {{args.replicas}} replicas in {{args.namespace}}"

    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: slack
      enabled_tools:
        - post_message
        - post_thread_reply

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
      SLACK_NOTIFICATION_CHANNEL:
        description: "Slack channel for deployment notifications (e.g., #deployments)"
        is_secret: false

  sub_agents:
    - name: health-monitor
      description: "Monitors deployment health post-rollout and reports status."
      instructions: |
        You monitor Kubernetes deployments after rollout. Check:
        - Pod readiness and restart counts
        - Deployment rollout status
        Report any anomalies immediately with recommended actions.
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:
            - get_pod_status
            - list_deployments

    - name: incident-reporter
      description: "Posts structured incident reports to Slack during deployment failures."
      instructions: |
        You post incident reports to Slack during deployment failures.
        Format: severity, affected service, current status, next action.
        Always use threading to keep incident updates in one place.
      mcp_access:
        - mcp_server: slack
          enabled_tools:
            - post_message
            - post_thread_reply
```

**Notes:**
- Three MCP servers: `github`, `kubernetes`, `slack` — all unique slugs ✓
- Kubernetes `rollback_deployment` has `requires_approval: false` to allow fast automated rollbacks
- `health-monitor` only needs read-only k8s tools → proper subset of parent's kubernetes tools ✓
- `incident-reporter` only needs Slack tools → proper subset of parent's Slack tools ✓
- Sub-agent names are unique ✓
- Both skills were verified with `get_skill` before authoring
- `version: stable` on the runbook skill pins to a controlled release
