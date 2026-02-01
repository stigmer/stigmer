# Workflow Run Command Implementation

**Date**: February 1, 2026

## Summary

Implemented `stigmer workflow run` command (Sub-task 7 of Phase 2), completing the workflow command group with full execution capabilities. The command reuses ~800 lines of existing run infrastructure with zero code duplication, mirroring the agent_run.go pattern exactly.

## Problem Statement

Users needed a dedicated `stigmer workflow run` command to execute workflows directly, rather than relying on the deprecated root `stigmer run` command. This provides consistent UX across resource types (agents have `stigmer agent run`, workflows now have `stigmer workflow run`).

### Pain Points

- No dedicated workflow execution command in the new command structure
- Root `run` command was deprecated but still the only way to execute workflows
- Inconsistent UX between agent and workflow commands

## Solution

Created `workflow_run.go` following the established agent_run.go pattern, reusing all existing execution infrastructure from the `run_*.go` files:
- `connectToBackend()` - Backend connection with org resolution
- `resolveWorkflow()` - Reference resolution (ID, slug, org/slug)
- `createWorkflowExecution()` - Execution creation via gRPC
- `streamWorkflowExecutionLogs()` - Real-time log streaming with approval handling

## Implementation Details

### New File: `cmd/stigmer/root/workflow_run.go` (187 lines)

```
newWorkflowRunCommand()     - Full-featured Cobra command
workflowRunOptions          - Options struct mirroring agentRunOptions
executeWorkflowRun()        - 6-step orchestration:
  1. Load and merge environment variables
  2. Connect to backend
  3. Resolve workflow by reference
  4. Create workflow execution
  5. Display execution started
  6. Stream logs if follow enabled
```

### Command Flags (Full Parity with agent run)

| Flag | Description |
|------|-------------|
| `--message, -m` | Initial trigger message for workflow |
| `--env` | Runtime environment variable (repeatable) |
| `--env-file` | Load environment from file (repeatable) |
| `--secret` | Secret environment variable (encrypted, repeatable) |
| `--secret-file` | Load secrets from file (encrypted, repeatable) |
| `--follow` | Stream execution logs (default: true) |
| `--org` | Organization ID override |

### Reference Formats Supported

- `wf_01abc123xyz456` - Direct workflow ID lookup
- `my-workflow` - Slug (uses context org)
- `acme-corp/my-workflow` - Explicit org/slug

### Files Modified

- `workflow.go` - Registered `newWorkflowRunCommand()`, removed placeholder
- `BUILD.bazel` - Added `workflow_run.go` to sources

## Benefits

- **Consistent UX**: Workflow commands now match agent commands exactly
- **Zero duplication**: Reuses ~800 lines of existing run infrastructure
- **Full feature parity**: All flags from root run and agent run supported
- **Helpful errors**: Troubleshooting guidance when workflow not found

## Impact

- **Users**: Can now use `stigmer workflow run my-workflow` with full functionality
- **CLI Structure**: Completes Sub-task 7 of Phase 2 (Workflow Command Restructuring)
- **Phase 2 Progress**: 7 of 8 sub-tasks now complete (87.5%)

## Related Work

- Phase 1: Agent YAML-First Foundation (complete)
- Phase 2 Sub-task 1: Workflow Internal Package
- Phase 2 Sub-task 2: Workflow Command Group
- Phase 2 Sub-task 3: Workflow Get Command
- Phase 2 Sub-task 4: Workflow Delete Command
- Phase 2 Sub-task 5: Workflow List Command
- Phase 2 Sub-task 6: Workflow Search Command
- **Phase 2 Sub-task 7: Workflow Run Command** (this changelog)

---

**Status**: ✅ Production Ready
**Pattern Consistency**: Mirrors agent_run.go (188 vs 187 lines)
**Coding Guidelines**: All met (file <250 lines, functions <50 lines)
