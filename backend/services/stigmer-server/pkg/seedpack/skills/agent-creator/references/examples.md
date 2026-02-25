# Agent YAML Examples

## Table of Contents
1. [Minimal Agent](#minimal-agent)
2. [Agent with Skills](#agent-with-skills)
3. [Agent with MCP Servers](#agent-with-mcp-servers)
4. [Agent with Sub-Agents](#agent-with-sub-agents)
5. [Agent with Tool Approval Overrides](#agent-with-tool-approval-overrides)
6. [Agent with Environment Variables](#agent-with-environment-variables)
7. [Full-Featured Agent](#full-featured-agent)
8. [Public Marketplace Agent](#public-marketplace-agent)

---

## Minimal Agent

The simplest valid agent — required fields only.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
  org: local
spec:
  description: "A simple conversational assistant"
  instructions: |
    You are a helpful assistant that answers questions clearly and concisely.
```

---

## Agent with Skills

Skills inject domain knowledge into the agent's context at runtime.

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
  description: "Reviews code for best practices and security issues"
  instructions: |
    You are a code review assistant. Review code for quality, security
    vulnerabilities, performance issues, and proper error handling.
  skill_refs:
    - org: local
      kind: skill              # Always "skill", never 43
      slug: code-analysis      # Must exist — verify with get_skill before writing
    - org: local
      kind: skill
      slug: company-style-guide
      version: stable          # Optional: pin to a mutable tag
```

---

## Agent with MCP Servers

MCP servers provide external tools. Always verify tool names exist on the server.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  org: local
  labels:
    team: engineering
spec:
  description: "Assists with GitHub operations — searching code, creating PRs, and managing issues"
  instructions: |
    You help developers with GitHub tasks. You can search code repositories,
    create pull requests, fetch file contents, and manage issues.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server       # Always "mcp_server", never 44
        slug: github           # Must exist — verify with get_mcp_server before writing
      enabled_tools:
        - search_code          # Tool names must exactly match what the server reports
        - create_pr
        - get_file
        - create_issue
        # Empty list is valid: means "use server's default_enabled_tools (or all)"
```

---

## Agent with Sub-Agents

Sub-agents handle specialized tasks with restricted MCP access. Defined inline — not separate resources.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-manager
  org: local
spec:
  description: "Coordinates engineering tasks — delegates code review and PR creation to specialized sub-agents"
  instructions: |
    You coordinate engineering work. Delegate based on task:
    - Code reviews → code-reviewer sub-agent
    - PR creation → pr-creator sub-agent
    Handle general engineering questions yourself.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
        - create_issue
  sub_agents:
    - name: code-reviewer           # Unique within sub_agents
      description: "Reviews code changes for quality and security issues"
      instructions: |               # Min 10 characters — enforced
        You review code changes for quality, security, and best practices.
        Provide specific, actionable feedback with line references.
      mcp_access:
        - mcp_server: github        # Must match a slug in parent's mcp_server_usages
          enabled_tools:            # Must be a SUBSET of parent's enabled_tools
            - search_code           # Parent has this ✓
            - get_file              # Parent has this ✓
            # create_pr NOT listed here — reviewer shouldn't create PRs
      skill_refs:                   # Independent of parent — any skill is valid
        - org: local
          kind: skill
          slug: security-checklist

    - name: pr-creator
      description: "Creates well-formatted pull requests with clear titles and descriptions"
      instructions: |
        You create pull requests with clear titles, descriptions, and changelogs.
        Always summarize what changed and why.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - create_pr             # Parent has this ✓
            - get_file              # Parent has this ✓
```

---

## Agent with Tool Approval Overrides

Customize Human-in-the-Loop (HITL) approval per tool. Tool names must be exact.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-bot
  org: local
spec:
  description: "Automated deployment agent with approval controls for destructive operations"
  instructions: |
    You automate deployment workflows. Always verify targets before executing.
    Destructive operations require user approval.
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: kubernetes
      enabled_tools:
        - deploy_app
        - rollback_deployment
        - get_pod_status
        - delete_deployment
      tool_approval_overrides:
        - tool_name: deploy_app         # Exact, case-sensitive match — typos silently fail
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}}"
        - tool_name: delete_deployment
          requires_approval: true
          message: "Delete deployment: {{args.name}} in {{args.namespace}}"
        - tool_name: rollback_deployment
          requires_approval: false      # Trusted for quick rollbacks — no approval
```

---

## Agent with Environment Variables

Declare required env vars in `env_spec`. Values are bound at runtime via AgentInstance.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: api-integrator
  org: local
spec:
  description: "Integrates with internal APIs using runtime-injected credentials"
  instructions: |
    You interact with internal APIs. Use the configured API_URL and AUTH_TOKEN
    from the environment to authenticate requests.
  env_spec:
    data:
      API_URL:
        description: "Base URL for the internal API (e.g., https://api.internal.example.com)"
        is_secret: false            # Plaintext — visible in logs
      AUTH_TOKEN:
        description: "Bearer token for API authentication"
        is_secret: true             # Encrypted at rest, redacted in logs
      LOG_LEVEL:
        description: "Logging verbosity: debug, info, warn, error"
        is_secret: false
        value: "info"               # Optional default for non-secret vars
```

---

## Full-Featured Agent

Uses all features together: MCP servers, approval overrides, skills, sub-agents, and env vars.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: devops-orchestrator
  org: local
  labels:
    team: devops
    environment: production
  tags:
    - deployment
    - automation
    - cicd
spec:
  description: "Orchestrates DevOps workflows — deployment, health checking, and rollback with approval controls"
  icon_url: "https://example.com/icons/devops.svg"
  instructions: |
    You orchestrate DevOps workflows safely.

    Responsibilities:
    - Review deployment configurations before executing
    - Execute deployment workflows via the kubernetes MCP server
    - Delegate health monitoring to the health-checker sub-agent
    - Rollback on failure

    Always confirm the target environment before destructive operations.
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
        - scale_deployment
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: false    # Trust for quick recovery
  skill_refs:
    - org: local
      kind: skill
      slug: kubernetes-best-practices
    - org: local
      kind: skill
      slug: company-deployment-procedures
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
      description: "Monitors deployment health — checks pod status and logs after rollout"
      instructions: |
        You monitor deployments after rollout. Check pod status, container logs,
        and readiness endpoints. Report any failures or anomalies immediately.
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:
            - get_pod_status         # Subset of parent's kubernetes tools
      skill_refs:
        - org: local
          kind: skill
          slug: sre-runbooks          # Sub-agent's own skill — independent of parent
```

---

## Public Marketplace Agent

Agents with `visibility_public` appear in the marketplace.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: research-assistant
  org: acme-corp             # Real org slug — not "local" in cloud mode
  visibility: visibility_public
  tags:
    - research
    - web-search
spec:
  description: "Searches the web and synthesizes cited research summaries on any topic"
  icon_url: "https://acme-corp.example.com/icons/research.svg"
  instructions: |
    You are a research assistant. For every user question:
    1. Search the web for relevant, recent information
    2. Synthesize findings into a clear, cited summary
    3. Highlight areas of uncertainty or conflicting sources

    Always include source URLs. Prioritize authoritative sources.
  mcp_server_usages:
    - mcp_server_ref:
        org: acme-corp
        kind: mcp_server
        slug: web-search
      enabled_tools:
        - search
        - fetch_page
  skill_refs:
    - org: acme-corp
      kind: skill
      slug: research-methodology
      version: stable                # Pin for marketplace reliability
```

