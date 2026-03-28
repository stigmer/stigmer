# Enable Git Write-Back by Default (MVP)

**Date**: March 28, 2026

## Summary

The incremental git write-back pipeline was fully implemented but never activated because no user-facing entry point set the required opt-in enum. This change flips the coordinator to treat `UNSPECIFIED` as "platform decides — enabled by default," activating automatic PR creation for all git-backed workspaces with credentials.

## Problem Statement

### Pain Points

- **Write-back never fires**: The `WriteBackCoordinator` eligibility check required `write_back_mode == GIT_WRITE_BACK_BRANCH_AND_PR` (enum value 1), but no entry point — CLI, Console, TS SDK, Python SDK, Go SDK, or MCP server — ever set this field. Proto default is `UNSPECIFIED` (0), which the coordinator rejected.
- **Dead code path**: The entire pipeline — branch creation, incremental commits, PR creation via GitHub API, `WriteBacksWidget` UI — was wired end-to-end but never executed. Users saw no PRs despite the feature being "shipped."
- **Opt-in gap**: The proto field existed on `GitRepoSource.write_back_mode`, the generated SDK types included `writeBackMode`, but the React hook (`useWorkspaceEntries.toInput()`) and CLI (`parseGitWorkspace`) never populated it.

## Solution

Rather than patching every entry point (CLI, Console, TS SDK, Python SDK, Go SDK, MCP server codegen), changed the single enforcement point — `WriteBackCoordinator._init_eligible_entries` — to treat `UNSPECIFIED` as enabled.

Defined an allowlist of enabled modes at the module level:

```python
_WRITE_BACK_ENABLED_MODES: frozenset[int] = frozenset({
    GIT_WRITE_BACK_MODE_UNSPECIFIED,  # platform default = enabled
    GIT_WRITE_BACK_BRANCH_AND_PR,     # explicit opt-in
})
```

The eligibility check now uses `not in _WRITE_BACK_ENABLED_MODES` instead of `!= GIT_WRITE_BACK_BRANCH_AND_PR`. This is forward-compatible: when a future `GIT_WRITE_BACK_DISABLED` enum value is added, entries with that value are automatically excluded without any coordinator change.

## Implementation Details

### Files Changed (Hand-Written)

| Area | File | Change |
|------|------|--------|
| Backend | `writeback_coordinator.py` | Added `_WRITE_BACK_ENABLED_MODES` allowlist, changed eligibility check from `!=` to `not in` |
| Proto | `enum.proto` | Updated `GIT_WRITE_BACK_MODE_UNSPECIFIED` comment: "platform default, currently enabled" |
| Proto | `workspace.proto` | Updated `write_back_mode` field comment: "platform decides, currently write-back enabled" |

### Files Auto-Generated

Proto generation (`make protos`) regenerated stubs across Go, Java, Python, TypeScript, Dart, and MCP server codegen — all from the hand-written `.proto` comment changes above.

### Design Decision: Backend Default vs Entry-Point Scatter

Chose to change the coordinator (single enforcement point) rather than patching 4+ entry points because:
- **Single change point**: one module instead of CLI, Console hook, Python SDK, Go SDK, MCP server
- **Proto semantics preserved**: `UNSPECIFIED` conventionally means "platform decides"
- **No SDK/CLI release needed**: behavior change is purely server-side
- **Forward-compatible**: future `DISABLED` enum value is excluded by the allowlist automatically
- **Non-destructive**: write-back creates a new branch and PR, never pushes to the user's working branch

## Benefits

- **Write-back activates immediately**: Any git-backed workspace with credentials now gets incremental PRs without any user configuration.
- **Zero integration burden**: Platform builders using TS/Python SDKs get the behavior without updating their code.
- **Clean opt-out path**: When needed, add `GIT_WRITE_BACK_DISABLED = 2` to the proto enum and a settings toggle. The allowlist handles exclusion automatically.

## Impact

- **End users**: Git-backed workspaces now produce PRs as the agent works — the originally intended behavior from the incremental write-back feature.
- **Platform builders**: No SDK changes needed. The behavior is activated server-side.
- **Future work**: Settings toggle for opt-out when users request it.

## Related Work

- Incremental git write-back and artifact staleness (`2026-03-28-162537`)
- Session-level artifacts widget (`2026-03-28-154305`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
