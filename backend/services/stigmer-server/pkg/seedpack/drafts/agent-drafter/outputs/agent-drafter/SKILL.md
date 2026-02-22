---
name: agent-drafter
description: Creates valid Stigmer Agent YAML files conforming to agentic.stigmer.ai/v1 API. Use when users need to create, update, or understand Agent resource definitions, including MCP server integrations, skill references, sub-agents, and environment specifications.
---

# Agent Drafter

Create valid Stigmer Agent YAML configurations that conform to the `agentic.stigmer.ai/v1` API specification.

## Agent Structure

Every Agent YAML follows this Kubernetes-style structure:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: agent-name
  labels:
    key: value
  tags:
    - tag1
    - tag2
spec:
  description: "Human-readable agent description"
  icon_url: "https://example.com/icon.png"
  instructions: "Agent system prompt and behavior"
  mcp_server_usages: []
  skill_refs: []
  sub_agents: []
  env_spec: {}
```

## Required Fields

**metadata.name**: Lowercase, hyphen-separated identifier (e.g., `code-reviewer`, `api-tester`)

**spec.description**: 1-2 sentence human-readable description for UI and marketplace display

**spec.instructions**: Agent's system prompt defining behavior and personality (minimum 10 characters)

## Optional Fields

**metadata.labels**: Key-value pairs for organization and filtering

**metadata.tags**: String array for categorization and search

**spec.icon_url**: Publicly accessible URL to agent icon (SVG, PNG, or JPEG)

**spec.skill_refs**: References to Skill resources providing agent knowledge

**spec.mcp_server_usages**: MCP server access configuration for external tools

**spec.sub_agents**: Specialized sub-agents for delegation

**spec.env_spec**: Required environment variables specification

## Skill References

Reference skills using `ApiResourceReference` format:

```yaml
skill_refs:
  - kind: skill
    org: local          # or platform, or organization name
    slug: skill-name
```

**Validation**: `kind` must equal `skill` (kind=43)

**Scopes**:
- `platform`: Platform-provided skills
- `local`: User's local skills  
- `org: <name>`: Organization-specific skills

## MCP Server Usage

Configure MCP servers to provide external tool access:

```yaml
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      scope: platform
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

**mcp_server_ref.kind**: Must be `mcp_server` (kind=44)

**enabled_tools**: Optional list restricting which tools are available. Empty list inherits from McpServer's default_enabled_tools.

**tool_approval_overrides**: Per-agent customization of approval requirements
- `requires_approval: true`: Tool requires approval (even if MCP has no default)
- `requires_approval: false`: Tool does NOT require approval (overrides MCP default)
- `message`: Optional approval prompt with `{{args.field}}` placeholders

**Scopes**:
- `platform`: Platform-provided MCP servers
- `organization`: Org-specific MCP servers

## Sub-Agents

Create specialized sub-agents for delegation. Sub-agents inherit parent's MCP access but can be restricted:

```yaml
sub_agents:
  - name: code-reviewer
    description: "Reviews code changes for quality"
    instructions: "You review code changes. Focus on security..."
    mcp_access:
      - mcp_server: github
        enabled_tools:
          - search_code
          - get_file
    skill_refs:
      - kind: skill
        org: platform
        slug: code-review-best-practices
```

**Permission model**:
- Sub-agent can only access MCP servers listed in parent's `mcp_server_usages`
- Sub-agent's `enabled_tools` must be a subset of parent's enabled tools
- Empty `enabled_tools` = all tools parent has enabled (no additional restriction)
- Sub-agent skills are independent of parent's skills

**Required fields**:
- `name`: Unique identifier within parent agent
- `instructions`: Minimum 10 characters

**Optional fields**:
- `description`: Helps parent decide when to delegate
- `mcp_access`: MCP server access grants
- `skill_refs`: Skill references for sub-agent knowledge

## Environment Variables

Specify required environment variables:

```yaml
env_spec:
  variables:
    - name: API_URL
      description: "Base URL for API endpoint"
      required: true
    - name: DEBUG_MODE
      description: "Enable debug logging"
      required: false
      default_value: "false"
```

## Validation Rules

1. **Naming**: Agent names must be lowercase with hyphens only (no underscores, spaces, or uppercase)
2. **Instructions length**: Must be at least 10 characters
3. **Skill references**: `kind` must equal `skill` (kind=43)
4. **MCP references**: `kind` must equal `mcp_server` (kind=44)
5. **Sub-agent tools**: Must be subset of parent's enabled tools for each MCP server
6. **MCP server slugs**: Must be unique within an Agent's `mcp_server_usages`

## Examples

### Minimal Agent

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A simple conversational assistant"
  instructions: "You are a helpful assistant that answers questions clearly and concisely."
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
    - kind: skill
      org: platform
      slug: code-analysis
    - kind: skill
      org: local
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
  instructions: "You help developers with GitHub tasks like searching code, creating PRs, and managing issues."
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
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
  description: "Manages engineering tasks with specialized sub-agents"
  instructions: "You coordinate engineering work by delegating to specialized sub-agents."
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
        - create_issue
  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes"
      instructions: "You review code for quality, security, and best practices."
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
      skill_refs:
        - kind: skill
          org: platform
          slug: code-review
    - name: pr-creator
      description: "Creates pull requests"
      instructions: "You create well-formatted pull requests with clear descriptions."
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
    You are a deployment automation assistant. You help teams deploy applications safely.
    
    Your responsibilities:
    - Review deployment configurations
    - Execute deployment workflows
    - Monitor deployment health
    - Rollback on failures
    
    Always verify deployment targets before executing changes.
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
    - mcp_server_ref:
        kind: mcp_server
        scope: organization
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
      org: platform
      slug: kubernetes-best-practices
    - kind: skill
      org: local
      slug: company-deployment-procedures
  env_spec:
    variables:
      - name: KUBERNETES_CLUSTER
        description: "Target Kubernetes cluster URL"
        required: true
      - name: SLACK_WEBHOOK
        description: "Slack webhook for deployment notifications"
        required: false
```

## Common Patterns

### Multi-Environment Agent

Use labels and environment variables for environment-specific configuration:

```yaml
metadata:
  name: api-tester
  labels:
    environment: staging
spec:
  env_spec:
    variables:
      - name: API_BASE_URL
        description: "API endpoint to test"
        required: true
      - name: AUTH_TOKEN
        description: "Authentication token"
        required: true
```

### Approval-Controlled Agent

Use tool approval overrides for sensitive operations:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        scope: platform
        slug: github
      tool_approval_overrides:
        - tool_name: delete_repository
          requires_approval: true
          message: "Delete repository: {{args.name}}?"
        - tool_name: force_push
          requires_approval: true
          message: "Force push to {{args.branch}}?"
```

### Knowledge-Augmented Agent

Combine multiple skills for comprehensive knowledge:

```yaml
spec:
  skill_refs:
    - kind: skill
      org: platform
      slug: api-design
    - kind: skill
      org: platform
      slug: security-best-practices
    - kind: skill
      org: local
      slug: company-api-standards
```

## Validation Checklist

Before applying your Agent YAML, verify:

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `Agent`
- [ ] `metadata.name` is lowercase with hyphens only
- [ ] `spec.description` clearly explains the agent's purpose
- [ ] `spec.instructions` is at least 10 characters
- [ ] All `skill_refs` have `kind: skill`
- [ ] All `mcp_server_ref` entries have `kind: mcp_server`
- [ ] Sub-agent `enabled_tools` are subsets of parent's tools
- [ ] MCP server slugs are unique within `mcp_server_usages`
- [ ] YAML is properly formatted and valid

## CLI Commands

```bash
# Validate agent YAML without applying
stigmer validate -f agent.yaml

# Apply agent configuration
stigmer apply -f agent.yaml

# Apply with dry-run to see what would happen
stigmer apply -f agent.yaml --dry-run

# List all agents
stigmer list agent

# Get agent details
stigmer get agent my-agent --output yaml

# Delete agent
stigmer delete agent my-agent
```

## Common Pitfalls

**Using uppercase or underscores in agent names**
- ❌ `Code_Reviewer`, `codeReviewer`
- ✅ `code-reviewer`

**Wrong kind values**
- ❌ `kind: Skill` (in skill_refs)
- ✅ `kind: skill`

**Forgetting minimum instruction length**
- ❌ `instructions: "Helper"`
- ✅ `instructions: "You are a helpful assistant."`

**Sub-agent tools exceeding parent's tools**
- ❌ Sub-agent has `delete_repo` when parent only enabled `search_code`
- ✅ Sub-agent's tools are subset of parent's enabled tools

**Duplicate MCP server slugs**
- ❌ Two `mcp_server_usages` with same `slug: github`
- ✅ Each MCP server slug appears only once

**Missing required fields in references**
- ❌ `skill_refs: [{org: local}]` (missing kind and slug)
- ✅ `skill_refs: [{kind: skill, org: local, slug: my-skill}]`

## Reference Files

For detailed schema information and validation rules, see:
- **references/proto-schemas.md**: Complete protobuf schema definitions
- **references/cli-examples.md**: Comprehensive CLI usage examples
