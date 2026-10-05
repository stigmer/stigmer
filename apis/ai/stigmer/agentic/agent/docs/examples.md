# Agent YAML Examples

Complete examples from minimal to full-featured. All examples use valid field values and can be applied directly.

## Minimal Agent

The simplest possible agent — just metadata, description, and instructions.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A simple conversational assistant"
  instructions: |
    You are a helpful assistant that answers questions clearly and concisely.
```

## Agent with Skills

An agent that uses skill references for specialized knowledge. Skill references omit the `org` field — the server resolves it from the agent's `metadata.org` at write time.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
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

An agent that uses external tools via MCP server integration. The `mcp_server_ref` uses a relative reference (no `org` field).

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
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
  tools: [Read, Grep, mcp__github]
  disallowed_tools: [mcp__github__delete_repository]
```

## Agent with Sub-Agents

A parent agent that delegates to specialized sub-agents, each narrowing the parent's tools.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-manager
spec:
  description: "Coordinates engineering tasks with specialized sub-agents"
  instructions: |
    You coordinate engineering work. Delegate to sub-agents based on the task:
    - Code reviews go to the code-reviewer sub-agent
    - PR creation goes to the pr-creator sub-agent
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
  tools: [Read, Grep, Agent, mcp__github]
  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes for quality and security"
      instructions: |
        You review code for quality, security, and best practices.
        Provide specific, actionable feedback.
      tools: [Read, Grep, mcp__github__search_code, mcp__github__get_file_contents]
    - name: pr-creator
      description: "Creates well-formatted pull requests"
      instructions: |
        You create pull requests with clear titles and descriptions.
        Always summarize the changes and their purpose.
      tools: [mcp__github__create_pull_request, mcp__github__get_file_contents]
```

## Full-Featured Agent

An agent using all available features — MCP servers narrowed by the tool lists, skills, sub-agents, and environment variables. Stigmer asks before `deploy_app` runs only if the kubernetes server marks it destructive (`destructiveHint: true`); shell commands and file writes always ask.

Note: `kubernetes` below is a user-defined MCP server (the org registered it themselves), not a marketplace entry — the marketplace catalog is HTTP-only, and self-registered stdio servers like this one run only on local runners.

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
    - mcp_server_ref:
        kind: mcp_server
        slug: kubernetes
  tools:
    - Read
    - Grep
    - Agent
    - mcp__github__search_code
    - mcp__github__get_file_contents
    - mcp__github__create_pull_request
    - mcp__kubernetes__deploy_app
    - mcp__kubernetes__rollback_deployment
    - mcp__kubernetes__get_pod_status
  skill_refs:
    - kind: skill
      slug: kubernetes-best-practices
    - kind: skill
      slug: company-deployment-procedures
  env_spec:
    data:
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
      tools: [mcp__kubernetes__get_pod_status]
```

## Agent Shared With Child Organizations

An agent a parent organization shares with every one of its child organizations. Uses absolute references (explicit `org`) to the parent's own resources, which must be shared with child organizations too: an agent may not be more visible than what it references.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: web-search-assistant
  org: acme-cloud
  visibility: visibility_child_orgs
  labels:
    category: productivity
  tags:
    - web-search
    - research
spec:
  description: "Searches the web and summarizes results for research tasks"
  icon_url: "https://acme-corp.example.com/icons/search.svg"
  instructions: |
    You are a research assistant. When users ask questions:
    1. Search the web for relevant information
    2. Synthesize findings into a clear, cited summary
    3. Highlight areas of uncertainty or conflicting information

    Always cite your sources with URLs.
  mcp_server_usages:
    - mcp_server_ref:
        org: acme-cloud
        kind: mcp_server
        slug: web-search
  tools: [mcp__web-search__search, mcp__web-search__fetch_page]
  skill_refs:
    - org: acme-cloud
      kind: skill
      slug: research-methodology
      version: stable
```

Key characteristics of an agent shared with child organizations:
- `metadata.org` is set explicitly to the parent organization (`acme-cloud`)
- `metadata.visibility` is `visibility_child_orgs`; every referenced skill and MCP server carries the same level
- Resource references use absolute `org` values naming the parent organization
- Skill version is pinned to `stable` for production reliability
