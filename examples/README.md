# Stigmer Examples

This directory contains example agents and skills to help you get started.

## Agents

### Support Bot (`agents/support-bot.yaml`)

A customer support agent that can:
- Answer questions using GitHub issues and documentation
- Post to Slack for escalation
- Access multiple MCP servers
- Run hookify's hooks around its tool calls

It references the `github` and `slack` MCP servers and the `hookify` plugin, so
those exist in your organization first. hookify installs from Claude Code's
official marketplace:

```bash
stigmer marketplace add anthropics/claude-plugins-official
stigmer install claude-plugins-official/hookify
```

**Usage**:
```bash
stigmer apply -f examples/agents/support-bot.yaml
stigmer agent execute support-bot "How do I reset my password?"
```

## Skills

### Calculator Skill (`skills/calculator/`)

A sample skill demonstrating proper structure and YAML frontmatter format.

**Features**:
- Basic arithmetic operations (add, subtract, multiply, divide)
- Error handling (division by zero, invalid inputs)
- Proper YAML frontmatter with required `name` field

**Testing Locally**:
```bash
cd examples/skills/calculator/
chmod +x calculator.sh
./calculator.sh add 5 3  # Output: 8
```

**Pushing the Skill**:
```bash
# Local push (auto-detects git metadata)
cd examples/skills/calculator/
stigmer skill push

# Remote push from GitHub
stigmer skill push \
  --git-url https://github.com/stigmer/stigmer.git \
  --git-ref main \
  --subdir examples/skills/calculator
```

**SKILL.md Format**:
```markdown
---
name: calculator
version: 1.0.0
description: Performs basic arithmetic operations
---

# Calculator Skill
...
```

See the [Calculator README](skills/calculator/README.md) for detailed documentation.

## Creating Your Own

### Skill Template

```
my-skill/
├── SKILL.md          # Required: Interface with YAML frontmatter
├── tool.sh           # Optional: Tool implementation
└── README.md         # Optional: Documentation
```

**SKILL.md with YAML frontmatter** (required):
```markdown
---
name: my-skill-name
version: 1.0.0
description: Brief description
---

# My Skill

## Tools

### my-tool
Description and usage...
```

**Push to Stigmer**:
```bash
stigmer skill push
```

See [Uploading Skills Guide](https://stigmer.ai/docs/guides/integrations) for details.

### Agent Template

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: my-agent
spec:
  instructions: |
    Your agent's instructions here.
  mcpServers:
    - github
    - filesystem
```

## More Examples

For more examples, see:
- [Stigmer Documentation](https://docs.stigmer.ai/examples)
- [Community Examples](https://github.com/stigmer/examples)
