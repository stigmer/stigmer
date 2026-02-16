---
name: agent-drafter
description: Helps create valid Stigmer Agent YAML files conforming to agentic.stigmer.ai/v1 API specification. Use when users need to create or modify Agent definitions, understand Agent YAML structure, configure MCP servers, add skills, define sub-agents, or validate Agent configurations.
---

# Agent Drafter

Create valid Stigmer Agent YAML files that conform to the API specification.

## Agent Structure

Every Agent YAML follows this Kubernetes-style structure:

```yaml
apiVersion: agentic.stigmer.ai/v1  # Always this value
kind: Agent                         # Always Agent
metadata:                           # Resource identification
  name: agent-name                  # Required: lowercase-with-hyphens
  labels:                           # Optional: key-value pairs
    team: engineering
  tags:                             # Optional: categorization
    - code-review
    - security
spec:                               # Agent configuration
  description: "Brief description"  # Required: 1-2 sentences
  instructions: |                   # Required: min 10 chars
    System prompt defining behavior...
```

## Required Fields

1. **metadata.name**: Lowercase with hyphens (e.g., `code-reviewer`, `api-tester`)
2. **spec.description**: Human-readable description for UI/marketplace display
3. **spec.instructions**: Agent's system prompt (minimum 10 characters)

## Common Configurations

### Minimal Agent

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A helpful general-purpose assistant"
  instructions: |
    You are a helpful assistant. Provide clear, accurate responses.
```

### Agent with Skills

Reference Skill resources to provide domain knowledge:

```yaml
spec:
  skill_refs:
    - kind: skill        # Always 'skill' (kind=43)
      org: local         # Organization: local, platform, or org name
      slug: skill-name   # Skill identifier
    - kind: skill
      org: platform
      slug: code-analysis
```

**Validation**: `kind` must be `skill` (numeric kind=43)

### Agent with MCP Servers

Grant access to external tools via MCP servers:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server  # Always 'mcp_server' (kind=44)
        scope: platform   # platform, organization, or omit for current org
        slug: github      # MCP server identifier
      enabled_tools:      # Optional: specific tools to enable
        - search_code
        - create_pr
        - get_file
```

**Empty enabled_tools**: Uses server's default_enabled_tools or all tools

**Tool approval overrides**: Customize approval requirements per agent:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools: [search_code, create_pr, delete_repository]
      tool_approval_overrides:
        - tool_name: delete_repository
          requires_approval: false  # Trust this agent
          message: ""               # Optional custom message
```

### Agent with Sub-Agents

Sub-agents enable delegation with restricted tool access:

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools: [search_code, create_pr, get_file]
  
  sub_agents:
    - name: code-reviewer              # Required: unique name
      description: "Reviews code"       # Helps parent decide when to delegate
      instructions: |                   # Required: min 10 chars
        You review code for quality and security issues.
      mcp_access:                       # Restricted to parent's servers
        - mcp_server: github            # Must match parent's slug
          enabled_tools:                # Subset of parent's tools
            - search_code
            - get_file
      skill_refs:                       # Independent skill access
        - kind: skill
          org: platform
          slug: code-review-best-practices
```

**Sub-agent permission model**:
- Can only access parent's MCP servers
- Tools must be subset of parent's enabled_tools
- Skills are independent (not restricted by parent)

### Agent with Environment Variables

Declare required environment variables:

```yaml
spec:
  env_spec:
    env_vars:
      - name: API_URL
        description: "Base URL for the API"
        required: true
        default_value: "https://api.example.com"
      - name: API_KEY
        description: "API authentication key"
        required: true
        is_secret: true  # Marks as sensitive
```

## Validation Checklist

Before applying an Agent YAML:

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `Agent`
- [ ] `metadata.name` uses lowercase-with-hyphens format
- [ ] `spec.instructions` is at least 10 characters
- [ ] All `skill_refs` have `kind: skill`
- [ ] All `mcp_server_ref` have `kind: mcp_server`
- [ ] Sub-agent `enabled_tools` are subset of parent's tools
- [ ] Sub-agent `mcp_server` references match parent's slugs

## Reference Format

Agents are referenced as `org/slug`:

```bash
# Apply agent to current organization
stigmer apply -f agent.yaml

# Reference in other resources
stigmer/code-reviewer
acme-corp/custom-agent
```

## Common Patterns

### Code Review Agent

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
  tags: [code-review, security]
spec:
  description: "Reviews code for best practices and security issues"
  instructions: |
    You are a code review assistant. Review code for:
    - Code quality and best practices
    - Security vulnerabilities
    - Performance issues
    - Proper error handling
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools: [search_code, get_file]
  skill_refs:
    - kind: skill
      org: platform
      slug: code-analysis
```

### Multi-Domain Agent with Sub-Agents

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-lead
spec:
  description: "Engineering team lead handling code review and deployment"
  instructions: |
    You coordinate engineering tasks. Delegate to sub-agents:
    - code-reviewer for code quality checks
    - deployment-manager for production deployments
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools: [search_code, create_pr, deploy]
  
  sub_agents:
    - name: code-reviewer
      description: "Reviews code changes"
      instructions: "You review code for quality and security."
      mcp_access:
        - mcp_server: github
          enabled_tools: [search_code]
      skill_refs:
        - kind: skill
          org: platform
          slug: code-review
    
    - name: deployment-manager
      description: "Handles deployments"
      instructions: "You deploy code to production safely."
      mcp_access:
        - mcp_server: github
          enabled_tools: [deploy]
      skill_refs:
        - kind: skill
          org: platform
          slug: deployment-best-practices
```

## Common Pitfalls

1. **Wrong kind values**: Use `kind: skill` (not `kind: 43`) and `kind: mcp_server` (not `kind: 44`)
2. **Invalid name format**: Names must be lowercase-with-hyphens, no underscores or spaces
3. **Short instructions**: Must be at least 10 characters
4. **Sub-agent tool expansion**: Sub-agents can only restrict parent's tools, not add new ones
5. **Missing scope in references**: Platform resources need `scope: platform` or `org: platform`

## CLI Commands

```bash
# Validate without applying
stigmer validate -f agent.yaml

# Apply agent
stigmer apply -f agent.yaml

# Apply to specific organization
stigmer apply -f agent.yaml --org acme-corp

# Get existing agent as YAML
stigmer get agent my-agent --output yaml > agent.yaml

# List all agents
stigmer list agent

# Search for agents
stigmer search agent "code review"

# Run an agent
stigmer run agent my-agent --message "Review the latest PR"
```

## Additional Resources

For complete proto schema details, see [references/schema-details.md](references/schema-details.md).
