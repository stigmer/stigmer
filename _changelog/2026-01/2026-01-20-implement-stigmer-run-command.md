# Implement `stigmer run` Command

**Date**: 2026-01-20
**Feature**: CLI Enhancement
**Impact**: Major - New command for running agents and workflows

## Summary

Implemented the `stigmer run` command in the Stigmer OSS CLI, providing an intuitive way to execute agents and workflows with auto-discovery and smart code synchronization.

## Motivation

Users needed a streamlined way to:
- Run agents and workflows from their project directory
- Automatically deploy latest code before execution
- Execute specific agents/workflows by name or ID
- Stream execution logs in real-time

Previously, users had to manually apply code changes and then separately trigger executions, which was cumbersome for iterative development.

## Implementation

### Two Operating Modes

#### 1. Auto-Discovery Mode (No Arguments)

```bash
stigmer run
```

**Flow:**
1. Checks for `Stigmer.yaml` in current directory
2. Auto-applies (deploys/updates) all agents and workflows
3. Shows deployed resources
4. If multiple resources: prompts user to select which one to run
5. If single resource: auto-selects and runs it
6. Creates execution and streams logs

**Use Case:** Local development - quick iteration on code

#### 2. Reference Mode (With Agent/Workflow Name or ID)

```bash
stigmer run <name-or-id>
```

**Flow:**
1. Checks if in a Stigmer project directory (has `Stigmer.yaml`)
2. **If in project directory:**
   - Auto-applies latest code first (ensures sync)
   - Resolves agent/workflow by name or ID
   - Creates execution and streams logs
3. **If outside project directory:**
   - Directly resolves agent/workflow (no apply)
   - Creates execution and streams logs

**Use Case:** 
- In project: Run specific agent/workflow with latest code
- Outside project: Run deployed agent/workflow from anywhere

### Key Features

#### Smart Code Synchronization

The command implements "code as source of truth" - when in a project directory, it always applies latest code before running:

```bash
# In project directory
stigmer run my-agent
# ✓ Detects Stigmer project
# ✓ Applies latest code from main.go
# ✓ Runs my-agent with fresh deployment
```

This eliminates the confusion of:
- "I changed my code but it's running the old version"
- "Do I need to apply first?"

#### Workflow-First Resolution

Both agents and workflows can be run with the same command. Workflows are checked first, then agents:

```bash
stigmer run data-processor    # Could be workflow or agent
```

#### Runtime Environment Variables

Support for execution-specific environment variables:

```bash
stigmer run my-agent \
  --runtime-env "API_KEY=abc123" \
  --runtime-env "secret:DB_PASSWORD=supersecret"
```

- Prefix with `secret:` for encrypted values
- Can specify multiple times

#### Custom Messages

Provide initial prompts for agents:

```bash
stigmer run my-agent --message "Process this data: ..."
```

#### Log Streaming Control

```bash
stigmer run my-agent              # Streams logs (default)
stigmer run my-agent --no-follow  # No streaming
```

### Implementation Details

#### File Structure

```
client-apps/cli/
├── cmd/stigmer/root/
│   └── run.go                      # New file (950+ lines)
├── internal/cli/config/
│   └── stigmer.go                  # Added InStigmerProjectDirectory()
└── cmd/stigmer/root.go             # Registered NewRunCommand()
```

#### Core Functions

1. **runReferenceMode()**: Handles execution by name/ID
2. **runAutoDiscoveryMode()**: Handles auto-discovery from project
3. **resolveAgent()**: Resolves agent by ID or slug
4. **resolveWorkflow()**: Resolves workflow by ID or slug
5. **executeAgent()**: Creates and streams agent execution
6. **executeWorkflow()**: Creates and streams workflow execution
7. **streamAgentExecutionLogs()**: Real-time agent log streaming
8. **streamWorkflowExecutionLogs()**: Real-time workflow log streaming

#### API Integration

Uses gRPC API methods:
- `AgentQueryController.Get()` - Get agent by ID
- `AgentQueryController.GetByReference()` - Get agent by slug
- `WorkflowQueryController.Get()` - Get workflow by ID
- `WorkflowQueryController.GetByReference()` - Get workflow by slug
- `AgentExecutionCommandController.Create()` - Create agent execution
- `WorkflowExecutionCommandController.Create()` - Create workflow execution
- `AgentExecutionQueryController.Subscribe()` - Stream agent execution updates
- `WorkflowExecutionQueryController.Subscribe()` - Stream workflow execution updates

#### Dependencies Added

- `github.com/AlecAivazis/survey/v2` - For interactive user prompts
- `github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind` - For API resource kinds

## UX Decision: Apply Before Run

### The Dilemma

When a user provides a slug/ID, there were multiple possible scenarios:
1. Resource exists locally but not applied
2. Resource exists locally and applied
3. Resource exists locally with changes but remote is old
4. Resource only exists remotely (not in local directory)

### Chosen Solution

**Always apply first if in a Stigmer project directory.**

**Rationale:**
- **Code is source of truth**: Users expect their local code to be what runs
- **Eliminates confusion**: No more "I changed it but it's running the old version"
- **Fast iteration**: Edit → `stigmer run` → See results (no extra `stigmer apply`)
- **Clear behavior**: If you're in a project directory, you're developing; apply happens automatically

**Alternative considered but rejected:**
- Prompt user: "Apply first?" → Too many decisions, slows workflow
- Never apply: → Users forget, run stale code, confusion
- Check for changes: → Complex, error-prone, unexpected behavior

### User Mental Model

```
Inside project directory = Development mode → Auto-apply
Outside project directory = Execution mode → No auto-apply
```

This matches natural user intent:
- When I'm in my project, I'm iterating on code → Keep it in sync
- When I'm elsewhere, I just want to run what's deployed → Don't touch anything

## Usage Examples

### Example 1: Quick Local Development

```bash
# In your project directory
cd ~/my-stigmer-project

# Run and auto-deploy
stigmer run

# Output:
# ✓ Loaded Stigmer.yaml
# ✓ Manifest loaded: 2 resource(s) discovered
# ✓ Deployed: 2 agent(s)
# 
# Select resource to run:
#   [Agent] data-processor - Processes customer data
#   [Agent] email-sender - Sends notification emails
# 
# > [Selected: data-processor]
# 
# ✓ Agent execution started: data-processor
# 
# ▶️  Execution started
# 🤖 Agent: Processing data...
# 🔧 Tool: query_database [Running]
# ✓ Done!
```

### Example 2: Run Specific Agent

```bash
stigmer run data-processor --message "Process recent orders"

# Output:
# 📁 Detected Stigmer project - applying latest code
# ✓ Deployed 2 resource(s)
# 
# ✓ Agent execution started: data-processor
# 
# 💬 You: Process recent orders
# 🤖 Agent: I'll fetch the recent orders from the database...
```

### Example 3: Run From Outside Project

```bash
cd ~/Desktop
stigmer run data-processor

# Output:
# ✓ Agent execution started: data-processor
# (No auto-apply - not in project directory)
```

### Example 4: Run Workflow

```bash
stigmer run customer-onboarding --message "New customer: john@example.com"

# Output:
# 📁 Detected Stigmer project - applying latest code
# ✓ Deployed: 1 workflow(s)
# 
# ✓ Workflow execution started: customer-onboarding
# 
# ▶️  Execution started
# ⚙️ Task: validate_email [Running]
# ✓ Task: validate_email [Completed]
# ⚙️ Task: create_account [Running]
# ✓ Task: create_account [Completed]
# ⚙️ Task: send_welcome_email [Running]
# ✓ Task: send_welcome_email [Completed]
# ✅ Execution completed
# 
# Duration: 3s
# Total tasks: 3
# Completed: 3
```

### Example 5: Run With Environment Variables

```bash
stigmer run deployment-agent \
  --runtime-env "ENVIRONMENT=production" \
  --runtime-env "REGION=us-east-1" \
  --runtime-env "secret:API_KEY=sk_prod_abc123xyz"

# Output:
# ✓ Agent execution started: deployment-agent
# (Execution has access to ENVIRONMENT, REGION, API_KEY)
```

### Example 6: Run Without Streaming

```bash
stigmer run data-processor --no-follow

# Output:
# ✓ Agent execution started: data-processor
# Execution ID: agx_01abc123xyz
# 
# View logs: stigmer run data-processor --follow
```

## Error Handling

### Not in Project Directory (Auto-Discovery)

```bash
$ stigmer run

Error: No Stigmer.yaml found in current directory

Either:
  • Run from a Stigmer project directory
  • Or specify agent/workflow: stigmer run <name-or-id>
```

### Resource Not Found

```bash
$ stigmer run nonexistent-agent

Error: Agent or Workflow not found: nonexistent-agent

Checked for:
  • Workflow with ID/name: nonexistent-agent
  • Agent with ID/name: nonexistent-agent

Possible reasons:
  • Resource doesn't exist in organization
  • Resource hasn't been deployed yet (run: stigmer apply)
  • Wrong organization context
```

### Invalid Runtime Environment

```bash
$ stigmer run my-agent --runtime-env "INVALID"

Error: Invalid runtime environment format: INVALID (expected key=value)
```

## Testing

### Manual Testing Checklist

- [ ] Auto-discovery with single agent
- [ ] Auto-discovery with multiple agents
- [ ] Auto-discovery with agents and workflows
- [ ] Run agent by name (in project)
- [ ] Run agent by name (outside project)
- [ ] Run agent by ID
- [ ] Run workflow by name
- [ ] Run workflow by ID
- [ ] Run with custom message
- [ ] Run with runtime environment variables
- [ ] Run with secret environment variables
- [ ] Run without log streaming (--no-follow)
- [ ] Log streaming for agent execution
- [ ] Log streaming for workflow execution
- [ ] Error handling: not in project directory
- [ ] Error handling: resource not found
- [ ] Error handling: invalid runtime env format

## Future Enhancements

1. **File Mode**: `stigmer run -f instance.yaml`
   - Apply instance manifest and immediately run it
   - Dev loop: edit → apply → run in one command

2. **Watch Mode**: `stigmer run --watch`
   - Watch for file changes
   - Auto-apply and re-run on changes
   - Hot reload for local development

3. **Interactive Mode**: `stigmer run --interactive`
   - Multi-turn conversation with agent
   - Send follow-up messages
   - Similar to `stigmer chat` but for specific execution

4. **Execution History**: `stigmer run --resume <execution-id>`
   - Resume or view previous execution
   - Useful for debugging

5. **Parallel Execution**: `stigmer run --all`
   - Run all agents/workflows in project
   - Useful for integration testing

## Related Files

- `client-apps/cli/cmd/stigmer/root/run.go` - Implementation
- `client-apps/cli/cmd/stigmer/root/apply.go` - Reuses ApplyCodeMode()
- `client-apps/cli/internal/cli/config/stigmer.go` - Added InStigmerProjectDirectory()
- `apis/ai/stigmer/agentic/agent/v1/query.proto` - Agent query API
- `apis/ai/stigmer/agentic/workflow/v1/query.proto` - Workflow query API
- `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` - Agent execution API
- `apis/ai/stigmer/agentic/workflowexecution/v1/api.proto` - Workflow execution API

## Migration Notes

None - This is a new command. No breaking changes.

## Comparison with Stigmer Cloud CLI

The Stigmer OSS `run` command is inspired by Stigmer Cloud's implementation but simplified:

**Similarities:**
- Auto-discovery mode
- Reference mode (by name/ID)
- Runtime environment variables
- Log streaming
- Workflow-first resolution

**Differences:**
- **OSS**: Always "organization" scope (local org)
- **Cloud**: Supports "platform" and "organization" scopes
- **OSS**: Simpler log streaming (phase + messages/tasks)
- **Cloud**: Advanced log streaming with Cursor-style updates, spinners, progress bars
- **OSS**: No instance mode (yet)
- **Cloud**: Supports running AgentInstances directly

**Why simpler in OSS:**
- Local-first: No multi-tenant concerns
- Focus on developer UX: Essential features first
- Can add advanced features later based on user feedback

## Conclusion

The `stigmer run` command provides a seamless experience for running agents and workflows in Stigmer OSS. The key innovation is **smart code synchronization** - automatically applying latest code when in a project directory, eliminating confusion and enabling fast iteration.

The two-mode design (auto-discovery vs reference) covers both "quick run" and "targeted execution" use cases, while the workflow-first resolution and runtime environment support make it a powerful tool for both development and production workflows.
