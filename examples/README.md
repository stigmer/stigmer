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
2. Analyzes code quality
3. Checks for test coverage
4. Generates a comprehensive review
5. Posts the review as a comment

**Usage**:
```bash
stigmer apply -f examples/workflows/pr-review.yaml
stigmer workflow execute pr-review-workflow \
  --input pr_url=https://github.com/myorg/myrepo/pull/123
```

## Creating Your Own

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
  inputs:
    some_input:
      type: string
      required: true
  tasks:
    - name: task-1
      agent: my-agent
      inputs:
        input: "${workflow.inputs.some_input}"
```

## More Examples

For more examples, see:
- [Stigmer Documentation](https://docs.stigmer.ai/examples)
- [Community Examples](https://github.com/stigmer/examples)
