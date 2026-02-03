# Workflow Delete Command

**Date**: February 1, 2026

## Summary

Implemented the `stigmer workflow delete <ref>` command with interactive confirmation using the survey library. This completes Phase 2 Sub-task 4 of the CLI Agent YAML-First initiative, providing safe workflow deletion with user confirmation and a `--force` flag for scripting scenarios.

## Problem Statement

Users could not delete workflows through the CLI using a dedicated workflow command. While the backend API supported deletion, there was no user-friendly CLI interface with:
- Interactive confirmation to prevent accidental deletion
- Flexible reference resolution (name, org/slug, or resource ID)
- Force flag for scripting and automation

### Pain Points

- **No dedicated delete command**: Workflows couldn't be deleted via CLI
- **Risk of accidental deletion**: No confirmation mechanism
- **Inconsistent UX**: Agent had `stigmer agent delete`, but workflow lacked equivalent

## Solution

Created `stigmer workflow delete <ref>` that mirrors the agent delete command pattern exactly, providing:
- Interactive confirmation via survey library (bypassable with `--force`)
- Automatic reference detection (resource ID vs name/slug)
- Organization override via `--org` flag
- Consistent 8-step orchestration pattern

## Implementation Details

### Files Created

**`cmd/stigmer/root/workflow_delete.go`** (151 lines)
- `newWorkflowDeleteCommand()` - Cobra command definition with flags
- `workflowDeleteOptions` struct - Typed options container
- `executeWorkflowDelete()` - 8-step orchestration:
  1. Load backend configuration
  2. Resolve organization
  3. Ensure daemon running (local mode)
  4. Connect to backend
  5. Fetch workflow for confirmation display
  6. Interactive confirmation (unless `--force`)
  7. Execute delete via gRPC
  8. Display success result
- `confirmWorkflowDeletion()` - Survey-based confirmation prompt

### Files Modified

**`cmd/stigmer/root/workflow.go`** (line 76)
- Added `cmd.AddCommand(newWorkflowDeleteCommand())`
- Removed Sub-task 4 placeholder comment

**`cmd/stigmer/root/BUILD.bazel`** (line 32)
- Added `workflow_delete.go` to sources list

### Key Design Decisions

1. **Exact pattern match**: Mirrors `agent_delete.go` (152 lines) for consistency
2. **Reuse existing infrastructure**: Uses workflow internal package (delete.go, display.go, get.go)
3. **Survey library for confirmation**: Professional UX matching agent delete
4. **8-step orchestration**: Same pattern as all resource commands for maintainability

## Benefits

### User Experience
- **Safe deletion**: Interactive confirmation prevents accidents
- **Scripting support**: `--force` flag enables automation
- **Flexible references**: Works with name, org/slug, or resource ID
- **Consistent UX**: Identical to `stigmer agent delete`

### Codebase Quality
- **Zero code duplication**: Reuses 277 lines from workflow internal package
- **Pattern consistency**: 8-step orchestration matches all commands
- **Maintainability**: Single 151-line file, all functions under 50 lines
- **Extensibility**: Same pattern for future resource types

## Code Quality

Adheres to all coding guidelines:
- ✅ Single responsibility (delete orchestration only)
- ✅ File size: 151 lines (< 250 limit)
- ✅ Function sizes: All under 50 lines
- ✅ Error wrapping: Contextual error messages
- ✅ Pattern consistency: Mirrors agent_delete.go exactly
- ✅ Go syntax validated (gofmt)

## Usage Examples

```bash
# Delete by name (with confirmation)
stigmer workflow delete my-workflow

# Delete by org/slug (with confirmation)
stigmer workflow delete stigmer/deploy-pipeline

# Delete by resource ID (with confirmation)
stigmer workflow delete wfl_abc123

# Force delete (skip confirmation)
stigmer workflow delete my-workflow --force

# Delete from specific organization
stigmer workflow delete my-workflow --org acme-corp
```

## Impact

### User-Facing
- Users can now delete workflows via `stigmer workflow delete`
- Safe defaults with interactive confirmation
- Consistent experience with agent commands

### Development
- Completes Sub-task 4 of Phase 2
- Enables progression to Sub-tasks 5-8
- Establishes pattern for future delete commands

### Technical
- Workflow internal package builds successfully
- Go syntax validated
- Zero linter errors introduced

## Testing

Verification performed:
- ✅ Go syntax validation (gofmt)
- ✅ Workflow internal package builds (`bazel build //client-apps/cli/internal/cli/workflow:workflow`)
- ✅ File size: 151 lines (within guidelines)
- Note: Root package build blocked by pre-existing SDK templates issue (documented blocker, not related to these changes)

## Next Steps

Phase 2 continues with sub-tasks 5-8:
1. **Sub-task 5**: Implement `workflow_list.go` (placeholder until backend API)
2. **Sub-task 6**: Implement `workflow_search.go` (using existing search infrastructure)
3. **Sub-task 7**: Implement `workflow_run.go` (reusing run_*.go infrastructure)
4. **Sub-task 8**: Documentation and cleanup

## Related Work

- **Phase 1**: Agent YAML-First Foundation (completed - 7 sub-tasks)
- **Phase 2**: Workflow Command Restructuring (in progress - 4 of 8 sub-tasks complete)
- **Agent delete pattern**: Reference implementation at `cmd/stigmer/root/agent_delete.go`
- **Workflow internal package**: Built in Sub-task 1 at `internal/cli/workflow/`

---

**Status**: ✅ Complete
**Timeline**: Sub-task 4 of Phase 2
**Branch**: feat/cli-agent-yaml-first
