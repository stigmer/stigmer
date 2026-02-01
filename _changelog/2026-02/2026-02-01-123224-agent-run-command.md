# Agent Run Command

**Date**: 2026-02-01
**Type**: Feature
**Scope**: CLI

## Summary

Added `stigmer agent run` command for executing agents, completing Phase 1 Sub-task 7 of the Agent YAML-First Foundation initiative. The command provides a dedicated, deterministic way to execute agents directly, while the root `stigmer run` command now shows a deprecation warning guiding users toward resource-specific commands.

## Changes

### New Files

- **`client-apps/cli/cmd/stigmer/root/agent_run.go`** (188 lines)
  - `newAgentRunCommand()` - Cobra command definition with all flags
  - `executeAgentRun()` - Orchestration function for agent execution
  - Flags: `--message/-m`, `--env`, `--env-file`, `--secret`, `--secret-file`, `--follow`, `--org`
  - Reuses existing infrastructure from `run_*.go` files (no duplication)

### Modified Files

- **`client-apps/cli/cmd/stigmer/root/agent.go`**
  - Registered `newAgentRunCommand()` subcommand
  - Added run examples to command help

- **`client-apps/cli/cmd/stigmer/root/run.go`**
  - Added deprecation warning directing users to `stigmer agent run` and `stigmer workflow run`

- **`client-apps/cli/cmd/stigmer/root/BUILD.bazel`**
  - Added `agent_run.go` to sources

## Architecture

The implementation follows the plan's key design decisions:

1. **Reuse over duplication**: All execution logic from `run_*.go` files is reused
2. **Agent-only execution**: Unlike root `run` which tries workflow → agent, this command is deterministic
3. **No auto-discovery**: Explicit reference required for predictable behavior
4. **Flag parity**: Same flags as root `run` for seamless migration
5. **Soft deprecation**: Root `run` continues working but shows warning

## Usage

```bash
# Run an agent by name
stigmer agent run my-agent

# Run with an initial message
stigmer agent run my-agent --message "Analyze this codebase"
stigmer agent run my-agent -m "Tell me a joke"

# Run by resource ID
stigmer agent run agt_01kewqjbtdy0w4d14bnhhy4yc2

# Run with org/slug format
stigmer agent run acme-corp/code-reviewer

# Run without streaming logs
stigmer agent run my-agent --no-follow

# Run with environment variables
stigmer agent run my-agent --env API_URL=https://api.example.com

# Run with secrets (encrypted)
stigmer agent run my-agent --secret API_KEY=sk_live_xxx

# Run with environment/secret files
stigmer agent run my-agent --env-file .env --secret-file .env.secrets
```

## Phase 1 Completion

This completes Phase 1 (Agent YAML-First Foundation) with all 7 sub-tasks:

| Sub-task | Description | Status |
|----------|-------------|--------|
| 1 | Agent YAML Loader | ✅ COMPLETED |
| 2 | Agent Schema Validator | ✅ COMPLETED |
| 3 | Agent Applier & Display | ✅ COMPLETED |
| 4 | Agent Apply Command | ✅ COMPLETED |
| 5 | Validate + Get Commands | ✅ COMPLETED |
| 6 | List + Delete Commands | ✅ COMPLETED |
| 7 | Run Command | ✅ COMPLETED |

## Testing

- Agent internal package builds successfully (`bazel build //client-apps/cli/internal/cli/agent:agent`)
- All agent tests pass (`bazel test //client-apps/cli/internal/cli/agent:agent_test`)
- Code follows gofmt formatting
- Coding guidelines compliance: files under 250 lines, functions follow patterns

## Next Steps

- Begin Phase 2 planning (Workflow Command Restructuring)
- Add `stigmer workflow run` command to complete resource-specific run commands
- Eventually remove root `run` command after migration period
