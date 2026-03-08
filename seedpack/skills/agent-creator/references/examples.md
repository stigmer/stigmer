# Agent YAML Examples

Ready-to-apply examples from minimal to full-featured.
All examples use valid field values and follow the production authoring rules.

---

## 1 — Minimal Agent

The simplest valid agent: metadata, description, and instructions.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
  org: default
spec:
  description: "A conversational assistant that answers questions clearly and concisely."
  instructions: |
    You are a helpful assistant. Answer questions clearly and concisely.
    If you are unsure, say so rather than guessing.
```

Apply and run:
```bash
stigmer apply -f simple-assistant.yaml
stigmer run simple-assistant "What is Stigmer?"
```

---

## 2 — Agent with MCP Server

An agent that uses a GitHub MCP server. Note how tool names come from
`stigmer get mcp-server github --output yaml` → `status.discovered_capabilities`.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
  org: acme-corp
  labels:
    team: engineering
  tags:
    - github
    - code
spec:
  description: "Helps with GitHub operations: searching code, creating PRs, and managing issues."
  instructions: |
    You help developers with GitHub tasks. You can search code,
    read files, create pull requests, and manage issues.

    Always confirm repository and branch before making changes.
    Summarize every PR you create with a clear title and description.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
        - create_issue
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo and read:org scopes"
        is_secret: true
```

---

## 3 — Agent with Skills

An agent that references skills for specialized knowledge.

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
  description: "Reviews code changes for quality, security vulnerabilities, and adherence to company standards."
  instructions: |
    You are an expert code reviewer. For every review:

    1. Identify security vulnerabilities (injection, auth issues, secrets in code)
    2. Evaluate code quality and style guide adherence
    3. Flag performance bottlenecks
    4. Provide specific, actionable improvement suggestions

    Be constructive. Acknowledge what is done well before critiquing.
  skill_refs:
    - kind: skill
      slug: company-style-guide
    - kind: skill
      slug: security-review-checklist
      version: stable
```

---

## 4 — Agent with Tool Approval Overrides (HITL)

An agent that requires human approval for destructive operations.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: database-manager
  org: acme-corp
  tags:
    - database
    - sql
spec:
  description: "Manages PostgreSQL databases: queries, schema inspection, and controlled data operations."
  instructions: |
    You manage PostgreSQL databases for the engineering team.

    You can run SELECT queries freely. For any write operation
    (INSERT, UPDATE, DELETE, DROP), always confirm the intent
    with the user before executing.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: postgres
      enabled_tools:
        - execute_query
        - list_tables
        - describe_table
        - execute_write
      tool_approval_overrides:
        - tool_name: execute_write
          requires_approval: true
          message: "Execute write query: {{args.query}}"
  env_spec:
    data:
      DATABASE_URL:
        description: "PostgreSQL connection URL (e.g., postgres://user:pass@host/db)"
        is_secret: true
```

---

## 5 — Agent with Sub-Agents

A parent agent that delegates specialized tasks. Sub-agent tool access is
restricted to subsets of the parent's enabled tools.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-coordinator
  org: acme-corp
  tags:
    - engineering
    - multi-agent
spec:
  description: "Coordinates engineering tasks by delegating to specialized code-review and PR-creation sub-agents."
  instructions: |
    You coordinate engineering work. Route tasks to the right sub-agent:

    - Code reviews → code-reviewer sub-agent
    - Pull request creation → pr-creator sub-agent

    After a sub-agent completes its task, summarize the outcome
    and ask the user for next steps.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
        - create_issue
  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes for quality, security, and best practices."
      instructions: |
        You review code changes. Focus on:
        - Security vulnerabilities (OWASP top 10)
        - Code quality and readability
        - Test coverage gaps
        Provide specific, line-referenced feedback.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file_contents
      skill_refs:
        - kind: skill
          slug: security-review-checklist

    - name: pr-creator
      description: "Creates well-structured pull requests with clear titles and descriptions."
      instructions: |
        You create pull requests. Always include:
        - A clear, imperative title (≤ 72 chars)
        - A description explaining the why, not just the what
        - A testing checklist
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - create_pull_request
            - get_file_contents
```

---

## 6 — Full-Featured Production Agent

All features: MCP servers, approval overrides, skills, sub-agents, env vars,
and marketplace metadata.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: deployment-assistant
  org: acme-corp
  visibility: visibility_private
  labels:
    team: devops
    environment: production
  tags:
    - deployment
    - kubernetes
    - automation
spec:
  description: "Automates Kubernetes deployment workflows with human-in-the-loop approval for destructive operations."
  icon_url: "https://assets.acme-corp.example.com/icons/deploy.svg"
  instructions: |
    You are a deployment automation assistant for Acme Corp.

    Your responsibilities:
    - Review deployment configurations before applying
    - Execute deployments to Kubernetes clusters
    - Monitor rollout health and surface issues
    - Initiate rollbacks on failure

    Rules:
    - Always state the target environment before any deployment
    - Require explicit confirmation for production deployments
    - Never skip health checks after rollout

  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools:
        - get_file_contents
        - create_pull_request
        - search_code

    - mcp_server_ref:
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
          message: "Deploy {{args.app_name}} to {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: true
          message: "Rollback {{args.app_name}} in {{args.environment}}"

  skill_refs:
    - kind: skill
      slug: kubernetes-best-practices
    - kind: skill
      slug: company-deployment-procedures
      version: stable

  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub PAT with repo scope"
        is_secret: true
      KUBERNETES_CLUSTER_URL:
        description: "Target Kubernetes API server URL"
        is_secret: false
      KUBERNETES_TOKEN:
        description: "Service account token for cluster access"
        is_secret: true

  sub_agents:
    - name: health-monitor
      description: "Monitors deployment health after rollout and reports pod status."
      instructions: |
        You monitor Kubernetes deployments after rollout. Check pod status,
        recent logs, and readiness probes. Report clearly: success, degraded,
        or failed, with evidence.
      mcp_access:
        - mcp_server: kubernetes
          enabled_tools:
            - get_pod_status
            - get_deployment_logs
```

---

## 7 — Public Marketplace Agent

An agent published to the marketplace. Uses absolute `org` references so other
organizations can reference its skills and servers.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: web-research-assistant
  org: acme-corp
  visibility: visibility_public
  labels:
    category: productivity
  tags:
    - research
    - web
    - summarization
spec:
  description: "Searches the web and synthesizes cited summaries for research tasks."
  icon_url: "https://assets.acme-corp.example.com/icons/research.svg"
  instructions: |
    You are a research assistant. For every research request:

    1. Search the web with 2-3 targeted queries
    2. Read the most relevant pages
    3. Synthesize findings into a structured summary
    4. Always include source URLs
    5. Flag conflicting information or areas of uncertainty

    Do not present opinions as facts.

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
      version: stable
```

---

## Discovery workflow (always run before authoring)

```bash
# 1. Find MCP servers
stigmer search mcp-server "github"
stigmer get mcp-server github --output yaml   # see discovered tools

# 2. Find skills
stigmer search skill "code review"
stigmer get skill code-review-checklist --output yaml

# 3. Apply your agent
stigmer apply -f my-agent.yaml

# 4. Test it
stigmer run my-agent "Hello, what can you do?"
```
