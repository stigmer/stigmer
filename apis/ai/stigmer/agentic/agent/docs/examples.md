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
  name: variance-reporter
  tags:
    - variance-report
    - accounting
spec:
  description: "Turns a customer's ledger into a variance report"
  instructions: |
    You review a customer's quarterly ledger and report how each account
    did against its budget:
    - Map each line to the customer's chart of accounts
    - Flag every account over or under budget
    - Lay out the report the way the variance-report Skill says
  skill_refs:
    - kind: skill
      slug: variance-report
    - kind: skill
      slug: chart-of-accounts
```

## Agent with Plugins

An agent that uses external tools through a plugin's MCP server. The plugin reference is relative (no `org` field); the agent gets the plugin whole, its skills and hooks too, and the tool lists narrow its server's tools.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: ledger-reader
  labels:
    team: finance
spec:
  description: "Reads a customer's ledger and lists each account's balance"
  instructions: |
    You read a customer's ledger with the ledger tools and list each
    account's balance for the period you are given. You never post an
    entry.
  plugins:
    - kind: plugin
      slug: ledger
  tools: [Read, Grep, mcp__plugin_ledger_ledger]
  disallowed_tools: [mcp__plugin_ledger_ledger__post_adjustment]
```

## Agent with Its Own MCP Server

An agent that carries an MCP server of its own instead of a plugin, as an integrator creates it from code in one call. Only an organization admin may apply it with the server. The header names the key as `${LEDGER_API_KEY}`, so the value is read from the conversation's vaults and never stored in the agent.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: variance-reporter
spec:
  description: "Turns a customer's ledger into a variance report"
  instructions: |
    Report how each account did against its budget. Read the ledger
    before you write the report.
  mcp_servers:
    - name: ledger
      url: https://ledger.acme-books.example/mcp
      headers:
        Authorization: Bearer ${LEDGER_API_KEY}
  tools: [Read, mcp__ledger]
```

## Agent with Subagents

A parent agent that hands work to two saved agents. Each subagent is an agent of its own, with its own plugins and tool lists; save them before the agent that lists them. See [subagents.md](subagents.md).

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: bank-reconciler
spec:
  description: "Matches a customer's bank statements to their ledger entries"
  instructions: |
    You reconcile bank statements. Match each statement line to the
    ledger entry it settles, and list every line left unmatched.
  plugins:
    - kind: plugin
      slug: ledger
  tools: [Read, Grep, mcp__plugin_ledger_ledger__get_ledger, mcp__plugin_ledger_ledger__list_accounts]
```

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: payroll-accruals
spec:
  description: "Proposes the month's payroll accruals as ledger adjustments"
  instructions: |
    You work out the month's payroll accruals from the payroll run and
    propose each one as an adjustment. Say which pay period each covers.
  plugins:
    - kind: plugin
      slug: payroll
    - kind: plugin
      slug: ledger
  tools: [mcp__plugin_payroll_payroll, mcp__plugin_ledger_ledger__post_adjustment]
```

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: month-end-close
spec:
  description: "Closes a customer's books at the end of the month"
  instructions: |
    You close a customer's books for the month. Hand work to subagents based on the task:
    - Matching bank statements goes to the bank-reconciler subagent
    - Payroll accruals go to the payroll-accruals subagent
  plugins:
    - kind: plugin
      slug: ledger
  tools: [Read, Grep, Agent, mcp__plugin_ledger_ledger]
  subagents:
    - kind: agent
      slug: bank-reconciler
    - kind: agent
      slug: payroll-accruals
```

Each subagent is pinned to its latest version when `month-end-close` is saved. Apply `month-end-close` again to take a newer version of either.

## Full-Featured Agent

An agent using all available features — plugins whose MCP servers the tool lists narrow, skills, a subagent, and environment variables. Stigmer asks before `deploy_app` runs only if the kubernetes server marks it destructive (`destructiveHint: true`); shell commands and file writes always ask.

Note: `kubernetes` below is the organization's own plugin carrying a local program (stdio), not a marketplace entry. A local program runs only where a person's own runner runs (the desktop app, the CLI); a conversation hosted in a cloud sandbox is refused at create when one of its plugins carries one.

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
  plugins:
    - kind: plugin
      slug: github
    - kind: plugin
      slug: kubernetes
  tools:
    - Read
    - Grep
    - Agent
    - mcp__plugin_github_github__search_code
    - mcp__plugin_github_github__get_file_contents
    - mcp__plugin_github_github__create_pull_request
    - mcp__plugin_kubernetes_kubernetes__deploy_app
    - mcp__plugin_kubernetes_kubernetes__rollback_deployment
    - mcp__plugin_kubernetes_kubernetes__get_pod_status
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
  subagents:
    - kind: agent
      slug: health-checker
```

The subagent it lists is a saved agent of its own, applied first:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: health-checker
spec:
  description: "Monitors deployment health after rollout"
  instructions: |
    You monitor deployments after rollout. Check pod status, logs,
    and health endpoints. Report any issues immediately.
  plugins:
    - kind: plugin
      slug: kubernetes
  tools: [mcp__plugin_kubernetes_kubernetes__get_pod_status]
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
  plugins:
    - org: acme-cloud
      kind: plugin
      slug: web-search
  tools: [mcp__plugin_web-search_web-search__search, mcp__plugin_web-search_web-search__fetch_page]
  skill_refs:
    - org: acme-cloud
      kind: skill
      slug: research-methodology
      version: stable
```

Key characteristics of an agent shared with child organizations:
- `metadata.org` is set explicitly to the parent organization (`acme-cloud`)
- `metadata.visibility` is `visibility_child_orgs`; every referenced skill and plugin carries the same level
- Resource references use absolute `org` values naming the parent organization
- Skill version is pinned to `stable` for production reliability
