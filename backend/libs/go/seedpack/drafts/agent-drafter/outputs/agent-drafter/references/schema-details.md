# Agent Schema Details

Complete reference for the Stigmer Agent API specification.

## Proto Schema Overview

The Agent resource is defined in `ai.stigmer.agentic.agent.v1`:

```protobuf
message Agent {
  string api_version = 1;  // const: 'agentic.stigmer.ai/v1'
  string kind = 2;         // const: 'Agent'
  ApiResourceMetadata metadata = 3;  // required
  AgentSpec spec = 4;
  AgentStatus status = 5;  // system-managed
}
```

## AgentSpec Fields

### Basic Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Human-readable description for UI/marketplace |
| `icon_url` | string | No | Publicly accessible image URL (SVG, PNG, JPEG) |
| `instructions` | string | Yes | System prompt (min 10 chars) |

### Resource References

| Field | Type | Description |
|-------|------|-------------|
| `mcp_server_usages` | McpServerUsage[] | MCP servers this agent can use |
| `skill_refs` | ApiResourceReference[] | Skills providing domain knowledge (kind=43) |
| `sub_agents` | SubAgent[] | Specialized agents for delegation |
| `env_spec` | EnvironmentSpec | Required environment variables |

## McpServerUsage

Declares MCP server access with optional tool restrictions and approval overrides.

### Fields

```yaml
mcp_server_usages:
  - mcp_server_ref:          # Required
      kind: mcp_server       # Always 'mcp_server' (kind=44)
      scope: platform        # platform, organization, or omit
      org: org-name          # Organization name if scope=organization
      slug: server-slug      # MCP server identifier
    enabled_tools:           # Optional: specific tools to enable
      - tool_name_1
      - tool_name_2
    tool_approval_overrides: # Optional: per-agent approval customization
      - tool_name: delete_repository
        requires_approval: false
        message: "Custom approval message with {{args.field}}"
```

### Tool Enabling Logic

- **Empty enabled_tools**: Uses McpServer's `default_enabled_tools` (or all if not specified)
- **Non-empty enabled_tools**: Only specified tools are available
- Tool names must match exactly (case-sensitive) what MCP server reports via `tools/list`

### Tool Approval Overrides

Override default approval requirements from McpServer:

- `requires_approval: true` - Force approval even if MCP server has no default
- `requires_approval: false` - Disable approval even if MCP server requires it
- `message` - Custom approval message with placeholder support `{{args.field}}`

**Approval Policy Chain** (lowest to highest priority):
1. McpServer.default_tool_approvals
2. Agent.tool_approval_overrides (this level)
3. AgentExecution.auto_approve_all (runtime)

## SubAgent

Specialized agent with restricted tool access for delegation.

### Fields

```yaml
sub_agents:
  - name: sub-agent-name         # Required: unique within parent
    description: "What it does"   # Helps parent decide when to delegate
    instructions: |               # Required: min 10 chars
      Sub-agent behavior...
    mcp_access:                   # Restricted to parent's servers
      - mcp_server: server-slug   # Must match parent's MCP server slug
        enabled_tools:            # Subset of parent's tools
          - tool1
          - tool2
    skill_refs:                   # Independent skill access
      - kind: skill
        org: platform
        slug: skill-name
```

### Permission Model

**MCP Server Access**:
- Sub-agent can only access MCP servers that parent has in `mcp_server_usages`
- `mcp_server` field references parent's McpServerUsage by slug
- Sub-agent tools must be subset of parent's `enabled_tools`
- Cannot expand tool access beyond parent's grants

**Skill Access**:
- Skills are independent of parent
- Sub-agents can reference any Skill resource
- Not restricted by parent's skill_refs

### Empty enabled_tools in Sub-Agent

When `enabled_tools` is empty in `mcp_access`:
- Sub-agent gets all tools that parent has enabled for that server
- Still cannot exceed parent's tool grants

## ApiResourceReference

Standard reference format for Skills and MCP Servers:

```yaml
# Minimal (current org)
- kind: skill
  slug: skill-name

# Platform resource
- kind: skill
  org: platform
  slug: skill-name

# Specific organization
- kind: skill
  org: org-name
  slug: skill-name

# With scope (alternative)
- kind: mcp_server
  scope: platform
  slug: server-name
```

### Kind Values

| Resource Type | String Value | Numeric Kind |
|---------------|--------------|--------------|
| Skill | `skill` | 43 |
| MCP Server | `mcp_server` | 44 |

**Important**: Use string values in YAML (`kind: skill`), not numeric (`kind: 43`).

## EnvironmentSpec

Declare required environment variables:

```yaml
env_spec:
  env_vars:
    - name: VAR_NAME
      description: "What this variable is for"
      required: true
      default_value: "default"
      is_secret: false  # Set true for sensitive values
```

### Environment Variable Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Variable name (uppercase with underscores) |
| `description` | string | No | Human-readable explanation |
| `required` | bool | No | Whether variable must be provided at runtime |
| `default_value` | string | No | Default if not provided |
| `is_secret` | bool | No | Mark as sensitive (encrypted storage) |

## Metadata Fields

Standard ApiResourceMetadata:

```yaml
metadata:
  name: agent-name              # Required: lowercase-with-hyphens
  labels:                       # Optional: key-value pairs
    key1: value1
    key2: value2
  tags:                         # Optional: string array
    - tag1
    - tag2
```

### Naming Conventions

**Valid names**:
- `code-reviewer`
- `api-tester`
- `data-analyzer-v2`

**Invalid names**:
- `code_reviewer` (underscore)
- `Code Reviewer` (spaces, uppercase)
- `codeReviewer` (camelCase)

## Validation Rules

### CEL Validation (from proto)

**MCP Server Usage**:
```cel
mcp_server_usages.mcp_server_ref.kind == 44
```
Message: "mcp_server_usages must reference resources with kind=mcp_server"

**Skill Refs**:
```cel
skill_refs.kind == 43
```
Message: "skill_refs must reference resources with kind=skill"

### Field Constraints

| Field | Constraint |
|-------|-----------|
| `api_version` | Must be exactly `agentic.stigmer.ai/v1` |
| `kind` | Must be exactly `Agent` |
| `metadata` | Required |
| `spec.instructions` | Minimum 10 characters |

## Complete Example

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-assistant
  labels:
    team: engineering
    environment: production
  tags:
    - code-review
    - deployment
    - automation
spec:
  description: "Engineering assistant for code review and deployment automation"
  icon_url: "https://example.com/icons/engineering.svg"
  instructions: |
    You are an engineering assistant that helps with:
    1. Code review - analyze code quality, security, and best practices
    2. Deployment - coordinate safe production deployments
    3. Documentation - ensure code is well-documented
    
    Delegate to sub-agents:
    - Use code-reviewer for detailed code analysis
    - Use deployment-manager for production deployments
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
        - deploy
      tool_approval_overrides:
        - tool_name: deploy
          requires_approval: true
          message: "Deploy to production: {{args.environment}}"
    
    - mcp_server_ref:
        kind: mcp_server
        org: acme-corp
        slug: internal-tools
      # empty enabled_tools = use all default tools
  
  skill_refs:
    - kind: skill
      org: platform
      slug: code-analysis
    - kind: skill
      org: acme-corp
      slug: company-standards
  
  sub_agents:
    - name: code-reviewer
      description: "Performs detailed code review and security analysis"
      instructions: |
        You are a code reviewer. Analyze code for:
        - Security vulnerabilities
        - Performance issues
        - Best practices
        - Code maintainability
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
      skill_refs:
        - kind: skill
          org: platform
          slug: security-best-practices
    
    - name: deployment-manager
      description: "Handles safe production deployments"
      instructions: |
        You manage deployments to production. Ensure:
        - All tests pass
        - Documentation is updated
        - Rollback plan is ready
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - deploy
      skill_refs:
        - kind: skill
          org: platform
          slug: deployment-checklist
  
  env_spec:
    env_vars:
      - name: GITHUB_TOKEN
        description: "GitHub API authentication token"
        required: true
        is_secret: true
      - name: DEPLOYMENT_ENV
        description: "Target deployment environment"
        required: false
        default_value: "staging"
```

## CLI Integration

### Validation

```bash
# Validate YAML syntax and schema
stigmer validate -f agent.yaml

# Dry run (validate without applying)
stigmer apply -f agent.yaml --dry-run
```

### Application

```bash
# Apply to current organization
stigmer apply -f agent.yaml

# Apply to specific organization
stigmer apply -f agent.yaml --org acme-corp

# Apply directory of YAMLs
stigmer apply -f ./agents/
```

### Retrieval

```bash
# Get agent as YAML
stigmer get agent my-agent --output yaml

# Get agent as JSON
stigmer get agent my-agent --output json

# List all agents
stigmer list agent

# Search agents
stigmer search agent "code review"
```

### Execution

```bash
# Run agent interactively
stigmer run agent my-agent

# Run with initial message
stigmer run agent my-agent --message "Review the latest PR"

# Run with environment variables
stigmer run agent my-agent --env API_URL=https://api.example.com

# Run with secrets
stigmer run agent my-agent --secret API_KEY=sk_live_xxx

# Auto-approve tool calls
stigmer run agent my-agent --approve-default approve
```

## Reference Format

Agents are referenced using `org/slug` format:

**Qualified slug** (recommended):
```
stigmer/code-reviewer
acme-corp/custom-agent
```

**Slug only** (requires org context):
```
code-reviewer
# Resolves to: <current-org>/code-reviewer
```

**Resource ID** (for automation):
```
agt_01abc123xyz
```

## Status Field (System-Managed)

The `status` field is system-managed and should not be included in YAML files:

```yaml
status:
  created_at: "2026-01-28T10:30:00Z"
  updated_at: "2026-01-30T15:45:00Z"
  created_by: usr_01xyz
  updated_by: usr_01xyz
  default_instance_id: ain_01abc
```

This information is automatically populated by the Stigmer platform.
