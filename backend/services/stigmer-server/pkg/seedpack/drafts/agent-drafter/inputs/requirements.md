# Agent-Drafter Skill Requirements

Create a skill that helps AI assistants create valid Stigmer Agent YAML files.

## Goal

This skill should enable an AI assistant to accurately generate Agent YAML configurations that conform to the Stigmer API specification. The skill should be used when users need to:
- Create new Agent definitions
- Understand the Agent YAML structure
- Learn about available fields and validation rules
- See examples of well-structured agents

## Key Information to Include

### 1. Agent Structure Overview

The Agent resource follows Kubernetes-style structure:
- `apiVersion`: Always `agentic.stigmer.ai/v1`
- `kind`: Always `Agent`
- `metadata`: Name, labels, tags
- `spec`: Agent configuration (description, instructions, skills, MCP servers)

### 2. Required Fields

- `metadata.name`: Lowercase, hyphen-separated identifier (e.g., `code-reviewer`)
- `spec.description`: 1-2 sentence human-readable description
- `spec.instructions`: Detailed system prompt (minimum 10 characters)

### 3. Optional Fields

- `metadata.labels`: Key-value pairs for organization
- `metadata.tags`: String array for categorization
- `spec.icon_url`: URL to agent icon
- `spec.skill_refs`: References to Skill resources
- `spec.mcp_server_usages`: MCP server access configuration
- `spec.sub_agents`: Specialized sub-agents for delegation
- `spec.env_spec`: Required environment variables

### 4. Skill References

Skills are referenced via `ApiResourceReference`:
```yaml
skill_refs:
  - kind: skill
    org: local          # or platform/organization scope
    slug: skill-name
```

### 5. MCP Server Usage

MCP servers provide external tool access:
```yaml
mcp_server_usages:
  - mcp_server_ref:
      scope: platform
      slug: github
    enabled_tools: [search_code, create_pr]
```

### 6. Sub-Agents

Sub-agents inherit parent MCP access but can be restricted:
```yaml
sub_agents:
  - name: code-reviewer
    description: "Reviews code changes"
    instructions: "You review code..."
    mcp_access:
      - mcp_server: github
        enabled_tools: [search_code, get_file]
    skill_refs:
      - kind: skill
        org: platform
        slug: code-review-best-practices
```

### 7. Validation Rules

- Agent names must be lowercase with hyphens only
- Instructions must be at least 10 characters
- `skill_refs` must reference kind=skill (kind=43)
- `mcp_server_ref` must reference kind=mcp_server (kind=44)
- Sub-agent tools must be subset of parent's enabled tools

## Expected Output

A SKILL.md file with:
1. Proper YAML frontmatter (`name`, `description`)
2. Clear, concise instructions for creating Agent YAMLs
3. Examples of minimal, typical, and full-featured agents
4. Validation checklist
5. Common pitfalls to avoid

## Target Audience

AI assistants (like Claude) that need to help users create Stigmer Agent configurations. The skill should provide enough context for accurate YAML generation without requiring additional documentation lookup.

## Constraints

- Follow the SKILL.md format from the skill-creator skill
- Keep concise - only include what Claude doesn't already know
- Avoid duplication between SKILL.md and any reference files
- No README.md, INSTALLATION_GUIDE.md, or other auxiliary files
