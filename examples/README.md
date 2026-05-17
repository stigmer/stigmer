# Stigmer Examples

This directory contains example agents and workflows to help you get started.

## Agents

### Support Bot (`agents/support-bot.yaml`)

A customer support agent that can:
- Answer questions using GitHub issues and documentation
- Post to Slack for escalation
- Access multiple MCP servers

**Usage**:
```bash
stigmer apply -f examples/agents/support-bot.yaml
stigmer agent execute support-bot "How do I reset my password?"
```

## Workflows

### PR Review Workflow (`workflows/pr-review.yaml`)

An automated code review workflow that:
1. Fetches PR details from GitHub
2. Analyzes code quality with AI agents
3. Checks test coverage
4. Generates a comprehensive review
5. Posts the review as a GitHub comment

**Usage**:
```bash
stigmer apply -f examples/workflows/pr-review.yaml
stigmer run workflow pr-review-workflow
```

### Hello World Workflow (`workflows/hello-world.yaml`)

A minimal starter workflow demonstrating basic workflow structure.

**Usage**:
```bash
stigmer apply -f examples/workflows/hello-world.yaml
stigmer run workflow hello-world
```

### Multi-Step Workflow (`workflows/multi-step.yaml`)

A comprehensive example demonstrating:
- Multiple task types (set_vars, http_call, agent_call, wait)
- Flow control between tasks
- Data export patterns
- Context variable usage

**Usage**:
```bash
stigmer apply -f examples/workflows/multi-step.yaml
stigmer run workflow multi-step-example
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

### Workflow Template

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: my-workflow
spec:
  description: Brief description of your workflow
  document:
    dsl: "1.0.0"
    namespace: my-namespace
    name: my-workflow
    version: "1.0.0"
  tasks:
    - name: first-task
      kind: set_vars
      task_config:
        variables:
          key: value
      export:
        as: "${.}"
      flow:
        then: second-task
    
    - name: second-task
      kind: agent_call
      task_config:
        agent: my-agent
        message: "Process this: ${context.first-task.key}"
      export:
        as: "${.result}"
      flow:
        then: end
```

## More Examples

For more examples, see:
- [Stigmer Documentation](https://docs.stigmer.ai/examples)
- [Community Examples](https://github.com/stigmer/examples)
