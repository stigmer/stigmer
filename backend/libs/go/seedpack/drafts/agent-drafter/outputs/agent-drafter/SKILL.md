---
name: agent-drafter
description: Creates and validates Stigmer Agent YAML configurations. Use this skill when users need to create new Agent definitions, understand Agent YAML structure, or learn about Agent configuration fields and validation rules. This skill provides schema details, examples, and validation guidance for the Stigmer agentic.stigmer.ai/v1 Agent resource.
---

# Agent Drafter

This skill helps you create valid Stigmer Agent YAML configurations that conform to the `agentic.stigmer.ai/v1` API specification.

## Agent Resource Structure

Agents follow Kubernetes-style resource structure:

```yaml
apiVersion: agentic.stigmer.ai/v1  # Always this exact value
kind: Agent                         # Always "Agent"
metadata:
  name: agent-name                  # Required: lowercase, hyphen-separated
  tags: [tag1, tag2]               # Optional: categorization
  labels:                          # Optional: key-value pairs
    key: value
spec:
  description: "..."               # Required: 1-2 sentence summary
  instructions: "..."              # Required: system prompt (min 10 chars)
  icon_url: "https://..."         # Optional: agent icon
  skill_refs: []                  # Optional: skill resources
  mcp_server_usages: []           # Optional: MCP server access
  sub_agents: []                  # Optional: delegation targets
  env_spec:                       # Optional: environment variables
    env_vars: []
```

## Required Fields

1. **apiVersion**: Must be `agentic.stigmer.ai/v1`
2. **kind**: Must be `Agent`
3. **metadata.name**: Lowercase with hyphens (e.g., `code-reviewer`, `api-tester`)
4. **spec.description**: Human-readable summary for UI display
5. **spec.instructions**: System prompt defining behavior (minimum 10 characters)

## Metadata Configuration

```yaml
metadata:
  name: my-agent              # Required: agent identifier
  tags:                       # Optional: for search/categorization
    - code-review
    - security
  labels:                     # Optional: key-value metadata
    team: engineering
    version: v1
```

**Naming rules:**
- Lowercase only
- Hyphens for word separation
- No spaces or special characters
- Example: `code-reviewer`, `api-tester`, `data-analyst`

## Instructions (System Prompt)

The `spec.instructions` field defines the agent's behavior and personality:

```yaml
spec:
  instructions: |
    You are a code review assistant specialized in security and best practices.
    
    When reviewing code:
    1. Check for security vulnerabilities (SQL injection, XSS, etc.)
    2. Validate error handling and edge cases
    3. Assess code quality and maintainability
    4. Suggest improvements with examples
    
    Always be constructive and explain your reasoning.
```

**Best practices:**
- Be specific about the agent's role and expertise
- Include concrete workflows or steps
- Set clear boundaries and constraints
- Use multi-line YAML (`|`) for readability
- Minimum 10 characters required

## Skill References

Skills provide specialized knowledge to agents. Reference skills using `kind: 43`:

```yaml
spec:
  skill_refs:
    - kind: skill                    # Must be "skill" (kind=43)
      org: local                     # Organization: local, platform, or org name
      slug: skill-name               # Skill identifier
    - kind: skill
      org: platform
      slug: code-analysis
```

**Validation:**
- `kind` must be `skill` (numeric kind=43)
- `slug` references the skill's identifier
- `org` specifies scope: `local`, `platform`, or organization name

## MCP Server Usage

MCP servers provide external tool access (APIs, databases, services):

```yaml
spec:
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server             # Must be "mcp_server" (kind=44)
        scope: platform              # platform, organization, or org name
        slug: github                 # MCP server identifier
      enabled_tools:                 # Optional: specific tools to enable
        - search_code
        - create_pr
        - get_file
      tool_approval_overrides:       # Optional: customize approval requirements
        - tool_name: delete_repository
          requires_approval: false   # Trust this agent
          message: "Delete repo: {{args.name}}"
```

**Key concepts:**
- `mcp_server_ref` must reference `kind: mcp_server` (numeric kind=44)
- `enabled_tools`: Empty list = all tools available
- `tool_approval_overrides`: Per-agent approval policy customization
- Tools not listed in `enabled_tools` are unavailable to the agent

**Tool approval example:**
```yaml
tool_approval_overrides:
  - tool_name: send_email
    requires_approval: true          # Force approval
    message: "Send email: {{args.subject}} to {{args.to}}"
  - tool_name: read_file
    requires_approval: false         # Disable approval
```

## Sub-Agents

Sub-agents are specialized agents for delegation. They inherit parent's MCP servers but with restricted access:

```yaml
spec:
  sub_agents:
    - name: code-reviewer            # Unique name for delegation
      description: "Reviews code changes for security"
      instructions: |
        You are a specialized code reviewer focused on security.
        Review code for vulnerabilities and compliance.
      mcp_access:                    # Restricted MCP server access
        - mcp_server: github         # Must match parent's mcp_server_ref.slug
          enabled_tools:             # Must be subset of parent's enabled_tools
            - search_code
            - get_file
      skill_refs:                    # Independent skill access
        - kind: skill
          org: platform
          slug: security-patterns
```

**Permission model:**
- Sub-agents can only access MCP servers that parent has in `mcp_server_usages`
- `mcp_access[].mcp_server` must match a parent's `mcp_server_ref.slug`
- Sub-agent `enabled_tools` must be subset of parent's enabled tools
- Skills are independent - sub-agents can use any skill

**Example delegation scenario:**
```yaml
# Parent agent
mcp_server_usages:
  - mcp_server_ref:
      slug: github
    enabled_tools: [search_code, get_file, create_pr, delete_branch]

# Sub-agent (restricted access)
sub_agents:
  - name: reader
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]  # Cannot create_pr or delete_branch
```

## Environment Variables

Define required environment variables for the agent:

```yaml
spec:
  env_spec:
    env_vars:
      - name: API_KEY
        description: "GitHub API token for repository access"
        required: true
      - name: WEBHOOK_URL
        description: "Optional webhook for notifications"
        required: false
```

## Complete Examples

### Minimal Agent

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: simple-assistant
spec:
  description: "A general-purpose assistant for answering questions"
  instructions: "You are a helpful assistant. Answer questions clearly and concisely."
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
  description: "Reviews code for security vulnerabilities and best practices"
  instructions: |
    You are a security-focused code reviewer.
    
    Review all code for:
    - Security vulnerabilities (injection, XSS, etc.)
    - Error handling and edge cases
    - Code quality and maintainability
  skill_refs:
    - kind: skill
      org: platform
      slug: security-patterns
    - kind: skill
      org: local
      slug: company-coding-standards
```

### Agent with MCP Servers

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: github-assistant
spec:
  description: "Manages GitHub repositories and pull requests"
  instructions: "You help manage GitHub repositories. Create PRs, review code, and manage issues."
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - create_pr
        - get_file
        - list_issues
  skill_refs:
    - kind: skill
      org: platform
      slug: git-workflows
```

### Full-Featured Agent with Sub-Agents

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: engineering-lead
  tags:
    - engineering
    - code-review
    - automation
  labels:
    team: platform
    priority: high
spec:
  description: "Engineering lead agent that coordinates code review and deployment"
  icon_url: "https://example.com/icons/eng-lead.svg"
  instructions: |
    You are an engineering lead that coordinates development tasks.
    
    Delegate to sub-agents:
    - Use 'security-reviewer' for security-focused code review
    - Use 'deployer' for production deployments
    
    Always provide clear feedback and ensure quality standards.
  
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        scope: platform
        slug: github
      enabled_tools:
        - search_code
        - get_file
        - create_pr
        - merge_pr
        - delete_branch
    - mcp_server_ref:
        kind: mcp_server
        scope: organization
        org: acme-corp
        slug: deployment-api
      enabled_tools:
        - deploy_staging
        - deploy_production
      tool_approval_overrides:
        - tool_name: deploy_production
          requires_approval: true
          message: "Deploy to production: {{args.service}}"
  
  skill_refs:
    - kind: skill
      org: platform
      slug: code-review
    - kind: skill
      org: local
      slug: deployment-checklist
  
  sub_agents:
    - name: security-reviewer
      description: "Specialized security code reviewer"
      instructions: |
        You review code specifically for security vulnerabilities.
        Focus on: SQL injection, XSS, CSRF, authentication issues.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - search_code
            - get_file
      skill_refs:
        - kind: skill
          org: platform
          slug: security-patterns
    
    - name: deployer
      description: "Handles production deployments"
      instructions: |
        You deploy applications following the deployment checklist.
        Always verify tests pass before deploying.
      mcp_access:
        - mcp_server: github
          enabled_tools:
            - get_file
        - mcp_server: deployment-api
          enabled_tools:
            - deploy_staging
            - deploy_production
      skill_refs:
        - kind: skill
          org: local
          slug: deployment-checklist
  
  env_spec:
    env_vars:
      - name: GITHUB_TOKEN
        description: "GitHub API token for repository access"
        required: true
      - name: SLACK_WEBHOOK
        description: "Slack webhook for deployment notifications"
        required: false
```

## Validation Checklist

Before finalizing an Agent YAML, verify:

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `Agent`
- [ ] `metadata.name` is lowercase with hyphens only
- [ ] `spec.description` is clear and concise (1-2 sentences)
- [ ] `spec.instructions` is at least 10 characters
- [ ] All `skill_refs` use `kind: skill` (not numeric 43)
- [ ] All `mcp_server_ref` use `kind: mcp_server` (not numeric 44)
- [ ] Sub-agent `mcp_access[].mcp_server` matches parent's `mcp_server_ref.slug`
- [ ] Sub-agent `enabled_tools` are subsets of parent's tools
- [ ] No duplicate MCP server slugs in `mcp_server_usages`
- [ ] YAML syntax is valid (proper indentation, no tabs)

## Common Pitfalls

**❌ Using numeric kind values:**
```yaml
skill_refs:
  - kind: 43  # Wrong - use string "skill"
```

**✅ Use string kind values:**
```yaml
skill_refs:
  - kind: skill  # Correct
```

**❌ Sub-agent using parent's MCP server without declaration:**
```yaml
sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github  # Parent must have github in mcp_server_usages
```

**✅ Parent must declare MCP server first:**
```yaml
mcp_server_usages:
  - mcp_server_ref:
      slug: github

sub_agents:
  - name: reviewer
    mcp_access:
      - mcp_server: github  # Now valid
```

**❌ Sub-agent tools exceed parent's tools:**
```yaml
mcp_server_usages:
  - mcp_server_ref:
      slug: github
    enabled_tools: [search_code]

sub_agents:
  - name: writer
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, create_pr]  # create_pr not in parent's list
```

**✅ Sub-agent tools are subset:**
```yaml
mcp_server_usages:
  - mcp_server_ref:
      slug: github
    enabled_tools: [search_code, create_pr]

sub_agents:
  - name: writer
    mcp_access:
      - mcp_server: github
        enabled_tools: [create_pr]  # Valid subset
```

**❌ Instructions too short:**
```yaml
spec:
  instructions: "Helper"  # Only 6 characters - minimum is 10
```

**✅ Meaningful instructions:**
```yaml
spec:
  instructions: "You are a helpful assistant that answers questions clearly."
```

## Quick Reference

**Create minimal agent:**
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: my-agent
spec:
  description: "Brief description"
  instructions: "Detailed system prompt"
```

**Add skills:**
```yaml
skill_refs:
  - kind: skill
    org: platform
    slug: skill-name
```

**Add MCP servers:**
```yaml
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      scope: platform
      slug: server-name
    enabled_tools: [tool1, tool2]
```

**Add sub-agent:**
```yaml
sub_agents:
  - name: sub-agent-name
    description: "What this sub-agent does"
    instructions: "Sub-agent system prompt"
    mcp_access:
      - mcp_server: parent-server-slug
        enabled_tools: [subset-of-parent-tools]
```

## CLI Usage

Once created, manage agents with the Stigmer CLI:

```bash
# Apply/create agent from YAML
stigmer apply -f agent.yaml

# Validate agent YAML without applying
stigmer validate -f agent.yaml

# List agents
stigmer list agent

# Get agent details
stigmer get agent my-agent

# Search agents
stigmer search agent "code review"

# Run an agent
stigmer run agent my-agent

# Delete agent
stigmer delete agent my-agent
```

For detailed CLI documentation, see the managing-agents guide.
