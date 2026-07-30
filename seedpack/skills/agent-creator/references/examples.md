# Agent YAML Examples

Production-quality examples from minimal to full-featured. All are valid and can be applied directly.

## Minimal Agent

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
  org: default
spec:
  description: "A simple conversational assistant"
  instructions: |
    You are a helpful assistant that answers questions clearly and concisely.
```

## Agent with Skills

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  org: default
  tags:
    - code-review
    - security
spec:
  description: "Reviews code for best practices and security issues"
  instructions: |
    You are a code review assistant. Review code for:
    - Code quality and best practices
    - Security vulnerabilities
    - Performance issues
    - Proper error handling
  skill_refs:
    - kind: skill
      slug: code-analysis
    - kind: skill
      slug: company-style-guide
```

## Agent with MCP Servers

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  org: default
  labels:
    team: engineering
spec:
  description: "Assists with GitHub operations and code management"
  instructions: |
    You help developers with GitHub tasks including searching code,
    creating pull requests, and managing issues.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
        - create_issue
```

## Agent with Sub-Agents

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-manager
  org: default
spec:
  description: "Coordinates engineering tasks with specialized sub-agents"
  instructions: |
    You coordinate engineering work. Delegate to sub-agents based on the task:
    - Code reviews go to the code-reviewer sub-agent
    - PR creation goes to the pr-creator sub-agent
    Handle general questions yourself.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
        - create_issue
  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes for quality and security"
      instructions: |
        You review code for quality, security, and best practices.
        Provide specific, actionable feedback.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
    - name: pr-creator
      description: "Creates well-formatted pull requests"
      instructions: |
        You create pull requests with clear titles and descriptions.
        Always summarize the changes and their purpose.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - create_pr
            - get_file
```

## Full-Featured Agent

Note: `kubernetes` below is a user-defined MCP server (the org registered it
themselves), not a marketplace entry — the marketplace catalog is HTTP-only,
and self-registered stdio servers like this one run only on local runners.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-assistant
  org: acme-corp
  visibility: visibility_public
  labels:
    team: devops
    environment: production
  tags:
    - deployment
    - automation
    - cicd
spec:
  description: "Automates deployment workflows with approval controls"
  icon_url: "https://example.com/icons/deploy.svg"
  instructions: |
    You are a deployment automation assistant. You help teams deploy
    applications safely.

    Your responsibilities:
    - Review deployment configurations
    - Execute deployment workflows
    - Monitor deployment health
    - Rollback on failures

    Always verify deployment targets before executing changes.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
    - mcp_server_ref:
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_app
        - rollback_deployment
        - get_pod_status
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: false
  skill_refs:
    - kind: skill
      slug: kubernetes-best-practices
    - kind: skill
      slug: company-deployment-procedures
  env:
    KUBERNETES_CLUSTER:
      description: "Target Kubernetes cluster URL"
      is_secret: false
    SLACK_WEBHOOK:
      description: "Slack webhook for deployment notifications"
      is_secret: true
  sub_agents:
    - name: health-checker
      description: "Monitors deployment health after rollout"
      instructions: |
        You monitor deployments after rollout. Check pod status, logs,
        and health endpoints. Report any issues immediately.
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:
            - get_pod_status
      skill_refs:
        - kind: skill
          slug: kubernetes-best-practices
```
