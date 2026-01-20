# Getting Started with Local Mode

Stigmer local mode runs entirely on your machine with a BadgerDB database. No servers, no cloud dependencies, no complexity.

## Quick Start (Recommended)

The fastest way to get started is with `stigmer new`, which scaffolds a complete working project in under 30 seconds:

```bash
# Option 1: Create in current directory (uses directory name as project name)
mkdir my-first-project && cd my-first-project
stigmer new

# Option 2: Create new directory with specified name
stigmer new my-first-project
cd my-first-project

# Start the Stigmer server
stigmer server

# Run the example workflow (analyzes a real GitHub PR)
stigmer run
```

**What you get:**
- ✅ Working AI agent (PR code reviewer)
- ✅ Working workflow (fetches and analyzes GitHub PRs)
- ✅ Zero configuration required
- ✅ Complete documentation in generated `README.md`
- ✅ Ready to customize and extend

The generated project demonstrates:
- How to define AI agents with natural language instructions
- How to create workflows that call agents
- How to integrate with external APIs (GitHub)
- How task dependencies work automatically

**Next steps after running the example:**
1. Read the generated `README.md` to understand what was created
2. Modify `main.go` to customize the agent or workflow
3. Deploy your changes: `stigmer apply`
4. Explore [customization examples](#customizing-generated-projects) below

**Note**: See [Deploying with Apply](../guides/deploying-with-apply.md) for complete apply command documentation.

---

## Alternative: Manual Setup

If you prefer to start from scratch or install Stigmer without a project:

### Installation

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

## Initialize and Start Local Backend

### First-Time Setup

```bash
stigmer init
```

This creates `~/.stigmer/local.db` with the initial schema.

**Output**:
```
✓ Created ~/.stigmer/local.db
✓ Initialized local backend
✓ Stigmer is ready to use in local mode

Next: stigmer local start
```

### Start Local Daemon

```bash
stigmer local start
```

**Troubleshooting with Debug Mode**:

If you encounter issues, enable debug mode to see detailed logs:

```bash
stigmer local start --debug
# or
stigmer local -d
```

Debug mode shows:
- Configuration loading details
- LLM provider resolution
- Temporal startup logs
- Agent runner initialization
- All internal process information

**Normal vs Debug Output**:
- **Normal mode**: Clean UI with progress indicators (recommended)
- **Debug mode**: Human-readable debug logs + progress UI (troubleshooting)

On first start, you'll be prompted for required API keys:

```
Enter Anthropic API key: ********
✓ Anthropic API key configured
✓ Starting managed Temporal server...
✓ Temporal started successfully
✓ Ready! Stigmer is running
  PID:  12345
  Port: 50051
  Data: /Users/you/.stigmer/data

Temporal UI: http://localhost:8233
```

**What happens:**
- Stigmer prompts for missing API keys (masked input)
- Downloads and starts Temporal server (auto-managed, no Docker required)
- Starts local stigmer-server on `localhost:50051`
- Starts agent-runner subprocess with injected secrets
- All processes run in background
- Temporal Web UI available at `http://localhost:8233`

**Subsequent starts:** If you've set `ANTHROPIC_API_KEY` in your environment, no prompt will appear.

### Temporal Web UI (Workflow Debugging)

When you start the local daemon, Temporal's Web UI is automatically available for visualizing and debugging workflows:

**Access**: http://localhost:8233

The Temporal UI provides:
- **Workflow visualization** - See all running and completed workflows
- **Execution history** - Inspect inputs, outputs, and events for each workflow
- **Task queues** - Monitor task queue activity and worker status
- **Workflow details** - Debug workflow state, activities, and errors

**Example use cases**:
```bash
# Start daemon (Temporal UI starts automatically)
stigmer local start
✓ Ready! Stigmer is running
  Temporal UI: http://localhost:8233

# Execute a workflow
stigmer workflow execute pr-review --input pr_url=https://github.com/org/repo/pull/123

# Open UI to watch execution in real-time
open http://localhost:8233
```

**What you'll see in the UI**:
1. **Workflows tab**: All workflow executions with status (Running, Completed, Failed)
2. **Task Queues tab**: Worker activity and pending tasks
3. **Workflow details**: Click any workflow to see:
   - Full execution timeline with all events
   - Input/output data for each activity
   - Stack trace for failed workflows
   - Workflow state and variables

**Debugging failed workflows**:
1. Navigate to http://localhost:8233
2. Find your workflow execution (search by workflow ID or filter by status)
3. Click to view execution details
4. Check "Event History" tab for step-by-step execution
5. Look for failed activities in red
6. Inspect error messages and stack traces

The Temporal UI is invaluable for understanding workflow execution flow and debugging issues.

### Check Status

```bash
stigmer local status
```

**Output**:
```
Stigmer Local Status:
─────────────────────────────────────
  Status: ✓ Running
  PID:    12345
  Port:   50051
  Data:   /Users/you/.stigmer/data

Temporal UI: http://localhost:8233
```

### Stop Local Daemon

```bash
stigmer local stop
```

This gracefully shuts down both stigmer-server and agent-runner.

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

## Customizing Generated Projects

If you used `stigmer new`, here's how to customize the generated project:

### Change the Target Repository

Edit `main.go` and modify the GitHub API URL:

```go
// Before: Analyzes stigmer/hello-stigmer
fetchPR := pipeline.HttpGet("fetch-pr",
    "https://api.github.com/repos/stigmer/hello-stigmer/pulls/1",
    // ...
)

// After: Analyze your repository
fetchPR := pipeline.HttpGet("fetch-pr",
    "https://api.github.com/repos/YOUR_ORG/YOUR_REPO/pulls/1",
    // ...
)
```

### Modify Agent Instructions

Change what the AI focuses on:

```go
agent.WithInstructions(`You are an expert code reviewer.

Focus on:
1. Security vulnerabilities
2. Performance issues
3. Code style consistency

Be concise and actionable.`)
```

### Add More Workflow Steps

Workflows are composable - add tasks as needed:

```go
// Send review to Slack
notify := pipeline.HttpPost("notify-slack",
    "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
    workflow.Body(analyze.Field("response")),
)
```

### Use Environment Variables

For sensitive data like API keys:

```go
ctx.SetString("slackWebhook", os.Getenv("SLACK_WEBHOOK_URL"))
```

### Development Workflow

**Typical workflow** after creating a project:

```bash
# Create project
stigmer new my-agent
cd my-agent

# Start server
stigmer server

# Deploy your code
stigmer apply

# Edit your code
vim main.go

# Redeploy (updates existing resources)
stigmer apply

# Validate before deploying
stigmer apply --dry-run
```

See [Deploying with Apply](../guides/deploying-with-apply.md) for complete documentation.

**For users** (when SDK is published):
- Running `stigmer new` automatically fetches the latest SDK
- Just works!

**For developers** (local SDK changes):

After creating a project, add these replace directives to `go.mod`:

```go
replace github.com/stigmer/stigmer/sdk/go => /path/to/local/sdk/go
replace github.com/stigmer/stigmer/apis/stubs/go => /path/to/local/apis/stubs/go
```

Then run:
```bash
go mod tidy
```

## Next Steps

- [Architecture Guide](../architecture/open-core-model.md)
- [Cloud Mode Guide](cloud-mode.md)
- [SDK Documentation](../api/)
- [Examples](../../examples/)

---

Local mode gives you the full power of Stigmer without any infrastructure. Perfect for development, personal projects, and learning.
