# Stigmer Agent Resource Guide

Comprehensive reference for creating valid Stigmer Agent YAML files conforming to the `agentic.stigmer.ai/v1` API.

## What is an Agent?

An Agent is a Kubernetes-style API resource that defines the **template layer** of an AI agent. It declares the agent's identity, behavior, tool access, and knowledge -- everything needed to describe _what_ an agent can do and _how_ it should behave.

Agents do not run on their own. The lifecycle is:

1. **Agent** (this resource) -- declares capabilities and configuration
2. **AgentInstance** -- binds an Agent to a runtime environment (provides secrets, credentials)
3. **AgentExecution** -- a single run of an agent instance within a session

The Agent resource is analogous to a Docker image: it describes what gets built, not how it runs.

## Agent YAML Structure

Every Agent YAML follows this structure:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: my-agent
  labels:
    team: engineering
  tags:
    - code-review
    - security
spec:
  description: "Human-readable description of the agent"
  icon_url: "https://example.com/icon.svg"
  instructions: |
    You are an agent that...
  mcp_server_usages: []
  skill_refs: []
  sub_agents: []
  env_spec: {}
```

### Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `Agent` |
| `metadata` | Yes | Standard API resource metadata |
| `spec` | Yes | Agent configuration (see below) |
| `status` | No | System-managed; never set by users |

### Metadata Fields

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name |
| `metadata.slug` | No | URL-friendly identifier (auto-generated from name if omitted). Lowercase alphanumeric with hyphens, starts with a letter, 1-63 chars. |
| `metadata.labels` | No | Key-value pairs for organization and filtering |
| `metadata.tags` | No | String array for categorization and search |

### Spec Fields

| Field | Required | Description |
|---|---|---|
| `spec.description` | Yes | 1-2 sentence summary for UI and marketplace display |
| `spec.icon_url` | No | Publicly accessible image URL (SVG, PNG, JPEG) |
| `spec.instructions` | Yes | System prompt defining behavior. Minimum 10 characters. |
| `spec.mcp_server_usages` | No | MCP servers this agent can use |
| `spec.skill_refs` | No | Skills providing agent knowledge |
| `spec.sub_agents` | No | Specialized sub-agents for delegation |
| `spec.env_spec` | No | Required environment variables |

## ApiResourceReference Format

References to other resources (MCP servers, skills) use `ApiResourceReference`:

```yaml
org: local           # Organization that owns the resource (required)
kind: mcp_server     # Resource kind: mcp_server (44) or skill (43)
slug: github         # Resource slug (required, unique within org)
version: stable      # Optional, only for versioned resources (Skills)
```

**`org` field**: Identifies ownership. Values:
- `local` -- local/single-tenant resources (bootstrapped system resources)
- An organization name (e.g., `acme-corp`) -- org-scoped resources

**`slug` field**: Lowercase alphanumeric with hyphens, starts with a letter, 1-63 characters.

**`version` field** (Skills only): Empty or omitted resolves to latest. Can also be a tag name (e.g., `stable`, `v1.0`) or an exact content hash for immutable pinning.

## MCP Server Integration

### What are MCP Servers?

MCP (Model Context Protocol) servers provide external tools and capabilities to AI agents through a standardized protocol. They enable agents to interact with external systems (GitHub, Slack, databases), access local resources, and execute custom operations.

MCP servers are first-class platform resources (`kind: McpServer`, kind=44). They are created and managed independently, then referenced by agents.

### How Agents Reference MCP Servers

Agents declare MCP server usage via `mcp_server_usages`:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
      tool_approval_overrides:
        - tool_name: delete_repository
          requires_approval: true
          message: "Delete repository: {{args.repo_name}}"
```

### MCP Server Usage Fields

| Field | Required | Description |
|---|---|---|
| `mcp_server_ref` | Yes | Reference to a McpServer resource. Must have `kind: mcp_server`. |
| `enabled_tools` | No | Tools to enable. Empty = use the McpServer's `default_enabled_tools` (or all tools if not set). |
| `tool_approval_overrides` | No | Per-agent approval policy customization |

### Tool Approval Overrides

Agents can customize which tools require user approval before execution:

```yaml
tool_approval_overrides:
  - tool_name: send_email
    requires_approval: true
    message: "Send email to {{args.recipient}}"
  - tool_name: delete_repository
    requires_approval: false   # Trust this agent for deletions
```

| Field | Description |
|---|---|
| `tool_name` | Must match the MCP server's tool name exactly (case-sensitive) |
| `requires_approval` | `true` = requires approval (even if MCP default doesn't). `false` = no approval (overrides MCP default). |
| `message` | Approval prompt shown to users. Supports `{{args.field}}` placeholders. |

### Tool Approval Policy Chain

Approval policies are resolved in order of increasing priority:

1. **McpServer.default_tool_approvals** -- platform/org defaults (lowest priority)
2. **Agent.McpServerUsage.tool_approval_overrides** -- per-agent customization
3. **AgentExecution.auto_approve_all** -- runtime bypass (highest priority)

### Runtime Resolution Flow

At runtime, the Agent does not connect to MCP servers directly. The flow is:

1. Agent declares `mcp_server_usages` (references only)
2. AgentInstance binds the Agent to an Environment (provides secrets/credentials)
3. Agent Runner resolves each McpServer, retrieves secrets from the Environment, and starts the actual MCP server process
4. The running MCP server's tools become available to the agent during execution

## Skill Integration

### What are Skills?

Skills are reusable packages of agent knowledge. A skill contains a `SKILL.md` file (with YAML frontmatter and Markdown instructions) that gets injected into the agent's context at runtime, providing specialized workflows, domain expertise, and tool guidance.

Skills are versioned resources (`kind: Skill`, kind=43). Each version is immutably identified by a content hash. Tags (e.g., `stable`, `latest`) provide mutable pointers to specific versions.

### How Agents Reference Skills

Agents declare skill references via `skill_refs`:

```yaml
spec:
  skill_refs:
    - org: local
      kind: skill
      slug: code-review-best-practices
    - org: local
      kind: skill
      slug: api-design-guide
      version: stable
```

### Skill Reference Fields

| Field | Required | Description |
|---|---|---|
| `org` | Yes | Organization owning the skill |
| `kind` | Yes | Must be `skill` (kind=43) |
| `slug` | Yes | Skill slug identifier |
| `version` | No | Tag or hash. Empty = latest version. |

### How Skills Are Injected

Skills are not executed -- they are read. At runtime:

1. The backend resolves each `skill_ref` to its `SKILL.md` content
2. The skill's `name` and `description` (from YAML frontmatter) are always present in the agent's context
3. The full `SKILL.md` body is loaded when the skill triggers (based on description matching the user's request)
4. Bundled resources (`references/`, `scripts/`, `assets/`) are loaded on demand by the agent

## Sub-Agents

Sub-agents enable delegation: the parent agent can route specialized tasks to focused sub-agents.

```yaml
spec:
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
    - name: code-reviewer
      description: "Reviews code changes for quality and security"
      instructions: |
        You review code changes. Focus on:
        - Security vulnerabilities
        - Performance issues
        - Code style consistency
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
      skill_refs:
        - org: local
          kind: skill
          slug: code-review-best-practices
```

### Sub-Agent Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier within the parent agent |
| `description` | No | Helps the parent decide when to delegate |
| `instructions` | Yes | System prompt for the sub-agent. Minimum 10 characters. |
| `mcp_access` | No | MCP server access grants (see below) |
| `skill_refs` | No | Skills for this sub-agent (independent of parent) |

### MCP Access (Sub-Agent)

`mcp_access` grants a sub-agent access to the parent's MCP servers:

```yaml
mcp_access:
  - mcp_server: github          # Must match a slug from parent's mcp_server_usages
    enabled_tools:               # Must be a SUBSET of parent's enabled_tools
      - search_code
      - get_file
```

| Field | Required | Description |
|---|---|---|
| `mcp_server` | Yes | Slug of one of the parent's MCP servers |
| `enabled_tools` | No | Subset of parent's tools. Empty = all parent's tools for this server. |

### Permission Model

- Sub-agents can **only** access MCP servers that the parent has in `mcp_server_usages`
- Sub-agent `enabled_tools` must be a **subset** of the parent's enabled tools (can restrict, cannot expand)
- Sub-agent `skill_refs` are **independent** of the parent (can reference any skill)

## Environment Specification

Agents can declare required environment variables. These define the **schema** -- actual values are provided at runtime via the AgentInstance's environment.

```yaml
spec:
  env_spec:
    data:
      API_URL:
        description: "Base URL for the target API"
        is_secret: false
      AUTH_TOKEN:
        description: "API authentication token"
        is_secret: true
```

| Field | Description |
|---|---|
| `data` | Map of variable name to `EnvironmentValue` |
| `EnvironmentValue.value` | Can be empty in the spec (values provided at runtime) |
| `EnvironmentValue.is_secret` | `true` = encrypted at rest, redacted in logs |
| `EnvironmentValue.description` | Documentation for the variable |

## Querying Available Resources

MCP servers and skills are first-class platform resources that can be discovered and inspected at runtime.

The **Stigmer MCP server** (`slug: stigmer-mcp-server`) exposes tools for querying the platform:

| Tool | Purpose |
|---|---|
| `search` | Full-text search across agents, skills, MCP servers, workflows |
| `get_agent` | Get a specific agent by org and slug |
| `get_mcp_server` | Get a specific MCP server by org and slug |
| `get_skill` | Get a specific skill by org and slug |
| `get_workflow` | Get a specific workflow by org and slug |

**When creating an agent:**

1. **Query available MCP servers** before writing `mcp_server_usages` -- use `search` or `get_mcp_server` to find real MCP servers with their actual tool names and descriptions
2. **Query available skills** before writing `skill_refs` -- use `search` or `get_skill` to find skills that match the agent's domain
3. **Never guess** resource references -- if a needed MCP server or skill doesn't exist, surface this to the user rather than inventing a reference

## Examples

### Minimal Agent

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

### Agent with Skills

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
    - org: local
      kind: skill
      slug: code-analysis
    - org: local
      kind: skill
      slug: company-style-guide
```

### Agent with MCP Servers

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
        org: local
        kind: mcp_server
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
        - create_issue
```

### Agent with Sub-Agents

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
        org: local
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

### Full-Featured Agent

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
      tool_approval_overrides:
        - tool_name: deploy_app
          requires_approval: true
          message: "Deploy {{args.app_name}} to {{args.environment}}"
        - tool_name: rollback_deployment
          requires_approval: false
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
```

## CLI Commands

```bash
# Apply (create or update) an agent from a YAML file
stigmer agent apply agent.yaml

# Validate without applying
stigmer agent apply agent.yaml --dry-run

# List all agents
stigmer agent list

# List agents from a specific organization
stigmer agent list --org acme-corp

# Search for agents by text
stigmer agent search "code review"

# Get agent details (table format)
stigmer agent get my-agent

# Get agent details as YAML
stigmer agent get my-agent --output yaml

# Delete an agent
stigmer agent delete my-agent
```

## Validation Checklist

Before applying an Agent YAML, verify:

- `apiVersion` is exactly `agentic.stigmer.ai/v1`
- `kind` is exactly `Agent`
- `metadata.name` is present
- `spec.description` clearly explains the agent's purpose
- `spec.instructions` is at least 10 characters and provides meaningful behavioral guidance
- All `skill_refs` have `kind: skill` (kind=43) with valid `org` and `slug`
- All `mcp_server_ref` entries have `kind: mcp_server` (kind=44) with valid `org` and `slug`
- MCP server slugs are unique within `mcp_server_usages`
- Sub-agent names are unique within `sub_agents`
- Sub-agent `mcp_access` references only MCP servers from the parent's `mcp_server_usages`
- Sub-agent `enabled_tools` are subsets of the parent's enabled tools for each MCP server
- YAML is properly formatted and syntactically valid

## Common Pitfalls

**Using uppercase or underscores in slugs**
- Wrong: `Code_Reviewer`, `codeReviewer`
- Correct: `code-reviewer`

**Wrong kind values in references**
- Wrong: `kind: Skill` (capitalized)
- Correct: `kind: skill`

**Instructions too short**
- Wrong: `instructions: "Helper"` (below 10-character minimum)
- Correct: `instructions: "You are a helpful assistant that..."`

**Sub-agent tools exceeding parent's tools**
- Wrong: Sub-agent has `delete_repo` when parent only enabled `search_code`
- Correct: Sub-agent's tools are always a subset of parent's enabled tools

**Duplicate MCP server slugs in one agent**
- Wrong: Two entries in `mcp_server_usages` with the same `slug: github`
- Correct: Each MCP server slug appears only once per agent

**Guessing resource references**
- Wrong: Writing `slug: github` without verifying the MCP server exists
- Correct: Query available MCP servers first, then reference only what exists

**Missing required fields in references**
- Wrong: `skill_refs: [{org: local}]` (missing kind and slug)
- Correct: `skill_refs: [{org: local, kind: skill, slug: my-skill}]`

**Sub-agent mcp_access referencing nonexistent parent MCP server**
- Wrong: `mcp_server: slack` when parent has no `slug: slack` in `mcp_server_usages`
- Correct: `mcp_server` must match a slug from parent's `mcp_server_usages`
