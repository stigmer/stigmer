# Getting Started with Local Mode

Stigmer local mode runs entirely on your machine with a BadgerDB database. No servers, no cloud dependencies, no complexity.

## Installation

### macOS/Linux

```bash
# Download and install
curl -sSL https://stigmer.ai/install.sh | bash

# Or with Homebrew
brew install stigmer/tap/stigmer
```

### Verify Installation

```bash
stigmer version
```

## Initialize Local Backend

```bash
stigmer init
```

This creates `~/.stigmer/local.db` with the initial schema.

**Output**:
```
✓ Created ~/.stigmer/local.db
✓ Initialized local backend
✓ Stigmer is ready to use in local mode

Try: stigmer agent execute my-agent "hello world"
```

## Create Your First Agent

### Using CLI

```bash
stigmer agent create support-bot \
  --instructions "You are a helpful customer support agent. Answer questions politely and provide accurate information." \
  --mcp-server github \
  --mcp-server filesystem
```

### Using YAML

Create `agent.yaml`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: support-bot
spec:
  instructions: |
    You are a helpful customer support agent.
    Answer questions politely and provide accurate information.
  mcpServers:
    - github
    - filesystem
```

Apply it:

```bash
stigmer apply -f agent.yaml
```

## Execute the Agent

```bash
stigmer agent execute support-bot "What are the open issues in myorg/myrepo?"
```

The agent will use the GitHub MCP server to fetch issues and respond.

## List Agents

```bash
stigmer agent list
```

**Output**:
```
AGENT ID          NAME          CREATED
agt-abc123        support-bot   2026-01-18 10:30:00
```

## View Agent Details

```bash
stigmer agent get support-bot
```

## Create a Workflow

Workflows orchestrate multiple agents and tasks:

```yaml
# workflow.yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: pr-review
spec:
  inputs:
    pr_url: string
  tasks:
    - name: fetch-pr
      agent: github-analyst
      inputs:
        pr_url: "${workflow.inputs.pr_url}"
    
    - name: review-code
      agent: code-reviewer
      inputs:
        code: "${tasks.fetch-pr.output.code}"
        files: "${tasks.fetch-pr.output.files}"
      dependsOn:
        - fetch-pr
    
    - name: post-comment
      agent: github-commenter
      inputs:
        pr_url: "${workflow.inputs.pr_url}"
        comment: "${tasks.review-code.output.review}"
      dependsOn:
        - review-code
```

Apply and execute:

```bash
stigmer apply -f workflow.yaml
stigmer workflow execute pr-review --input pr_url=https://github.com/myorg/myrepo/pull/123
```

## Managing Secrets

Secrets in local mode are encrypted and stored in your OS keychain (or `~/.stigmer/master.key`).

### Create Environment with Secrets

```bash
stigmer env create production \
  --secret GITHUB_TOKEN=ghp_xxxxxxxxxxxx \
  --secret API_KEY=sk_xxxxxxxxxxxx \
  --var REGION=us-west-2
```

### Use Environment in Execution

```bash
stigmer agent execute support-bot "Check production status" --env production
```

The agent can reference secrets using `${secrets.GITHUB_TOKEN}`.

## Check Backend Status

```bash
stigmer backend status
```

**Output**:
```
Current backend: local
Database: ~/.stigmer/local.db
Tables: 12
Agents: 3
Workflows: 2
Executions: 47
```

## Execution History

List recent executions:

```bash
stigmer execution list
```

Get details:

```bash
stigmer execution get exec-abc123
```

## Export/Import

Export all resources:

```bash
stigmer export --all > stigmer-backup.yaml
```

Import resources:

```bash
stigmer import < stigmer-backup.yaml
```

## Upgrading to Cloud Mode

When you're ready for team collaboration:

```bash
stigmer login
```

This switches to Stigmer Cloud. Your workflow definitions don't change—only the backend.

## Troubleshooting

### Database Locked

If you see "database is locked":

```bash
# Check for other stigmer processes
ps aux | grep stigmer

# Kill if needed
killall stigmer

# Or wait for WAL checkpoint
```

### Reset Database

**⚠️ This deletes all data**:

```bash
rm ~/.stigmer/local.db
stigmer init
```

### Enable Debug Logging

```bash
stigmer --debug agent execute support-bot "test"
```

## Next Steps

- [Architecture Guide](../architecture/open-core-model.md)
- [Cloud Mode Guide](cloud-mode.md)
- [SDK Documentation](../api/)
- [Examples](../../examples/)

---

Local mode gives you the full power of Stigmer without any infrastructure. Perfect for development, personal projects, and learning.
