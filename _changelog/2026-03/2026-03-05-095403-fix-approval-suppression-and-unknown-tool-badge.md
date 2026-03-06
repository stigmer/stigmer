# Fix Approval Suppression Leak and Unknown Tool Badge

**Date**: March 5, 2026

## Summary

Fixed two test failures in the CLI inline renderer: rejected tool approvals were incorrectly marking completion events for suppression (leaking IDs), and unknown/MCP tools were missing the `✓`/`✗` status badge that known tools display.

## Problem Statement

Two tests were failing in `cmd/stigmer/root`:

### Pain Points

- `TestHandleApproval_DoesNotSuppressOnReject`: The `trackSuppression` function unconditionally added write/edit/delete tool IDs to the suppression map regardless of the approval action. When a tool is rejected, the backend never executes it and no `ToolCompletedEvent` arrives — the suppressed ID leaks in the map forever.
- `TestInlineRenderer_ToolCompleted_ShowsBadge`: Unknown/MCP tools rendered via `renderCompactUnknown` showed `● tool_name` without a status badge, while all known tools displayed `✓` (completed) or `✗` (failed) via `RenderWithBadge`.

## Solution

Two targeted one-line fixes in the rendering pipeline:

1. **Gate suppression on approve action** — `trackSuppression` now checks `action == "approve"` before adding to the suppression map. Only approved tools execute and generate completion events that need deduplication.
2. **Add status badge to unknown tool header** — `buildUnknownCompactHeader` now appends `StateBadge(tc.Status)` after the metadata suffix, giving unknown/MCP tools visual parity with known tools.

## Implementation Details

### Files Changed

- `client-apps/cli/cmd/stigmer/root/run_stream_inline_approval_display.go` — Added `action == "approve"` guard to `trackSuppression`
- `client-apps/cli/pkg/toolrender/render_compact.go` — Added `StateBadge` call to `buildUnknownCompactHeader`

### Key Decision

The `trackSuppression` function already received the `action` parameter but never used it. The fix leverages the existing parameter rather than changing the call signature.

## Benefits

- Eliminates memory leak from rejected tool IDs accumulating in the suppression map
- Unknown/MCP tool completions now show `✓`/`✗` status badges consistent with built-in tools
- All CLI tests pass with zero regressions

## Impact

- **CLI inline renderer**: Approval flow and tool display correctness
- **MCP tool UX**: Users see completion status for all tools, not just built-in ones

---

**Status**: ✅ Production Ready
