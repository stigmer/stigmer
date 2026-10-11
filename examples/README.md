# Stigmer Examples

This directory contains example agents and skills to help you get started.

## Agents

### Support Bot (`agents/support-bot.yaml`)

A customer support agent that can:
- Answer questions using GitHub issues and documentation
- Post to Slack for escalation
- Use the MCP servers of the plugins it lists
- Run hookify's hooks around its tool calls

It lists the `github`, `slack` and `hookify` plugins, so those are installed in
your organization first. An MCP server on its own is installed as a one-server
plugin with `stigmer mcp add <name> <url>`, and hookify installs from Claude
Code's official marketplace:

```bash
stigmer mcp add github https://api.githubcopilot.com/mcp/
stigmer mcp add slack <your Slack MCP server URL>
stigmer marketplace add anthropics/claude-plugins-official
stigmer install claude-plugins-official/hookify
```

**Usage**:
```bash
stigmer apply -f examples/agents/support-bot.yaml
stigmer run support-bot -m "How do I reset my password?"
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
  plugins:
    - kind: plugin
      slug: github
```

## More Examples

For more examples, see:
- [Stigmer Documentation](https://docs.stigmer.ai/examples)
- [Community Examples](https://github.com/stigmer/examples)
