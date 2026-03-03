# Collapse HITL Approval Blocks by Default

**Date**: March 3, 2026

## Summary

Changed HITL approval blocks in the CLI TUI to start collapsed by default, and fixed a threshold bug that prevented multi-line content (like file writes) from being collapsible at all. Users can press Enter to expand and inspect the full content before approving.

## Problem Statement

When an agent requested approval for a tool call with large content (e.g., writing a 200-line file), the approval block flooded the viewport with the entire content, burying the "APPROVAL REQUIRED" header and making the UX confusing.

### Pain Points

- The approval block for write tools was **not expandable at all** because the expandability threshold counted JSON keys (2 for `path` + `content`) instead of visual lines (200+)
- Even when blocks were correctly expandable (e.g., shell commands with many lines), they defaulted to expanded state, flooding the viewport on arrival
- The user had no way to collapse the content to see the approval prompt in context

## Solution

Two targeted fixes in the CLI rendering layer:

1. **Fix the expandability threshold**: Count visual lines (splitting multi-line arg values on `\n`) instead of JSON key count, so tools with large content values become properly expandable.
2. **Default to collapsed**: Change `newApprovalBlock` to start with `expanded: false` instead of `true`.

## Implementation Details

### `render_approval.go` — Visual line counting

Added `countArgVisualLines()` that splits each arg entry on `\n` and sums the total. Changed `renderGenericApprovalContent` to use this for the threshold check. Updated `buildGenericApproval` to truncate by visual line count, which also fixes a pre-existing bug where continuation lines of multi-line values lacked the `"   "` indentation prefix.

### `blocks.go` — Default collapsed state

Removed the explicit `expanded: true` from `newApprovalBlock`, so expandable approval blocks start collapsed. The user presses Enter to expand.

### `approval_test.go` — New test coverage

- `TestRenderApprovalContent_GenericTool_MultilineContent_Expandable`: Verifies that 2 JSON keys with a 20-line multi-line value correctly produce an expandable block with truncation indicator.
- `TestNewApprovalBlock_Expandable_StartsCollapsed`: Verifies expandable approval blocks default to `expanded: false` and `displayContent()` returns the preview.

## Benefits

- **Compact viewport**: Approval prompts no longer flood the screen with hundreds of lines of content
- **User control**: Content is one keypress away (Enter) but not forced on the user
- **Consistent behavior**: All tool approvals (shell and generic) follow the same collapsed-by-default pattern
- **Backward compatible**: Short content (below threshold) still renders inline without expand/collapse

## Impact

- **End users**: Approval prompts are now compact and scannable; full content is available on demand
- **Existing tests**: All 40 existing tests pass unchanged

## Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/pkg/executiontui/render_approval.go` | Visual line counting for threshold + truncation |
| `client-apps/cli/pkg/executiontui/blocks.go` | Default collapsed state |
| `client-apps/cli/pkg/executiontui/approval_test.go` | 2 new test cases |

## Related Work

- [2026-03-03-084312](2026-03-03-084312-expandable-hitl-approval-content.md) — Expandable HITL approval content (introduced the expand/collapse mechanism)

---

**Status**: ✅ Production Ready
