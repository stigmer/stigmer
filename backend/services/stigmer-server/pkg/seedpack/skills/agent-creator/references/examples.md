# Agent YAML Examples

Annotated examples for common agent archetypes. Use these as structural references.

## Table of Contents
1. [Minimal Agent](#1-minimal-agent)
2. [Agent with Skills Only](#2-agent-with-skills-only)
3. [Agent with MCP Servers](#3-agent-with-mcp-servers)
4. [Agent with Tool Approval Controls](#4-agent-with-tool-approval-controls)
5. [Agent with Sub-Agents](#5-agent-with-sub-agents)
6. [Agent with Environment Variables](#6-agent-with-environment-variables)
7. [Full-Featured Agent](#7-full-featured-agent)

---

## 1. Minimal Agent

Use when the agent needs no external tools or skills — pure LLM behavior.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A conversational assistant that answers questions clearly and concisely."
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
    If you don't know something, say so honestly rather than guessing.
```

---

## 2. Agent with Skills Only

Use when the agent needs domain knowledge injected at runtime but no external tools.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  tags:
    - code-review
    - security
spec:
  description: "Reviews code for quality, security issues, and best practices."
  instructions: |
    You are a code review expert. When reviewing code:
    - Identify security vulnerabilities and explain the risk
    - Flag performance bottlenecks with suggested improvements
    - Check for proper error handling and edge cases
    - Enforce style conventions from the company style guide
    Provide specific, actionable feedback with line references.
  skill_refs:
    # Verified via: get_skill(org="local", slug="code-analysis")
    - org: local
      kind: skill
      slug: code-analysis
    # Verified via: get_skill(org="local", slug="company-style-guide")
    - org: local
      kind: skill
      slug: company-style-guide
```

---

## 3. Agent with MCP Servers

Use when the agent needs to call external tools/APIs.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  labels:
    team: engineering
  tags:
    - github
    - developer-tools
spec:
  description: "Assists developers with GitHub operations including code search, PR creation, and issue management."
  instructions: |
    You help developers with GitHub tasks. You can search code, read files,
    create pull requests, and manage issues.

    Always confirm the target repository before making changes.
    When creating PRs, include a clear title, summary of changes, and testing notes.
  mcp_server_usages:
    # Verified via: get_mcp_server(org="local", slug="github")
    # Tool names confirmed from MCP server's tools/list
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
        - create_issue
        - list_prs
```

---

## 4. Agent with Tool Approval Controls

Use when certain tools are sensitive and require human-in-the-loop confirmation.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: database-admin-assistant
  tags:
    - database
    - administration
spec:
  description: "Assists database administrators with queries, schema changes, and maintenance tasks."
  instructions: |
    You assist database administrators. You can run queries, inspect schemas,
    and perform maintenance tasks.

    For destructive operations (DROP, DELETE, TRUNCATE), always explain what will
    be affected before requesting approval.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: postgres-db
      enabled_tools:
        - execute_query
        - list_tables
        - describe_table
        - drop_table
        - truncate_table
      tool_approval_overrides:
        # Require explicit user approval for destructive operations
        - tool_name: drop_table
          requires_approval: true
          message: "Drop table '{{args.table_name}}' from database '{{args.database}}'"
        - tool_name: truncate_table
          requires_approval: true
          message: "Truncate all rows from '{{args.table_name}}'"
        # execute_query already requires approval at the McpServer level (inherited)
```

---

## 5. Agent with Sub-Agents

Use when the agent orchestrates specialized roles with different tool access.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-coordinator
  labels:
    team: platform
  tags:
    - orchestration
    - engineering
spec:
  description: "Coordinates engineering workflows by delegating to specialized sub-agents for code review, PR management, and deployment."
  instructions: |
    You coordinate engineering workflows. Analyze the user's request and delegate
    to the appropriate sub-agent:
    - Code quality/security questions → code-reviewer
    - Creating or merging PRs → pr-manager
    - Deployment tasks → deployer

    Synthesize sub-agent results and present a unified response.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
        - merge_pr
        - create_issue
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - get_pod_status
        - deploy_app
        - rollback_deployment
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}}"

  sub_agents:
    - name: code-reviewer
      description: "Reviews code for quality, security issues, and style consistency"
      instructions: |
        You are a thorough code reviewer. Examine code for security vulnerabilities,
        performance issues, and style violations. Reference the code review skill
        for detailed criteria. Provide specific feedback with line references.
      mcp_access:
        - mcp_server: github
          enabled_tools:         # Read-only subset of parent's github tools
            - search_code
            - get_file
      skill_refs:
        - org: local
          kind: skill
          slug: code-review-best-practices

    - name: pr-manager
      description: "Creates well-structured pull requests and handles merges"
      instructions: |
        You manage pull requests. Create PRs with descriptive titles and detailed
        summaries. Verify CI status before merging. Always include what changed
        and why in the PR description.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - get_file
            - create_pr
            - merge_pr

    - name: deployer
      description: "Deploys applications to Kubernetes and monitors rollout health"
      instructions: |
        You deploy applications to Kubernetes. Verify deployment configurations
        before applying. Monitor pod status during rollout. Initiate rollback
        immediately if pods fail to become ready within 5 minutes.
      mcp_access:
        - mcp_server: kubernetes
          # enabled_tools omitted: inherits all parent kubernetes tools
```

---

## 6. Agent with Environment Variables

Use when the agent (or its MCP servers) need secrets or configuration at runtime.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: api-integration-assistant
spec:
  description: "Integrates with external APIs to fetch data and trigger workflows."
  instructions: |
    You integrate with external APIs. Use the configured API_URL as the base
    endpoint. Include the AUTH_TOKEN in Authorization headers. If ENVIRONMENT
    is "production", apply extra caution and request confirmation before writes.
  env_spec:
    data:
      API_URL:
        description: "Base URL for the target API (e.g., https://api.example.com/v2)"
        is_secret: false
      AUTH_TOKEN:
        description: "Bearer token for API authentication"
        is_secret: true      # Encrypted at rest, redacted in logs
      ENVIRONMENT:
        description: "Deployment environment: development, staging, or production"
        is_secret: false
```

---

## 7. Full-Featured Agent

A complete example combining all features.

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
    - automation
    - cicd
spec:
  description: "Automates deployment workflows with human-in-the-loop approval for production changes."
  icon_url: "https://example.com/icons/deploy.svg"
  instructions: |
    You are a deployment automation assistant. Help teams deploy applications safely.

    Your responsibilities:
    - Review deployment configurations before applying
    - Execute deployment workflows with proper approval gates
    - Monitor deployment health post-rollout
    - Initiate rollback immediately on failure

    Always confirm the target environment before executing any changes.
    In production, require explicit user confirmation for deploys and rollbacks.
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
        - list_deployments
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} v{{args.version}} to {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: true
          message: "Rollback {{args.deployment_name}} in {{args.namespace}}"
  skill_refs:
    - org: local
      kind: skill
      slug: kubernetes-best-practices
    - org: local
      kind: skill
      slug: company-deployment-procedures
      version: stable
  env_spec:
    data:
      KUBERNETES_CLUSTER:
        description: "Target Kubernetes cluster API URL"
        is_secret: false
      SLACK_WEBHOOK:
        description: "Slack webhook URL for deployment notifications"
        is_secret: true
  sub_agents:
    - name: health-checker
      description: "Monitors deployment health after rollout and reports anomalies"
      instructions: |
        You monitor deployments after rollout. Check pod status, readiness probes,
        and recent logs. Report any CrashLoopBackOff, OOMKilled, or pending pods
        immediately with actionable diagnosis.
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:      # Read-only subset: no deploy or rollback
            - get_pod_status
            - list_deployments
```
