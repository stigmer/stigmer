# Fix Skip Approval Collapse UX

**Date**: March 5, 2026

## Summary

Fixed the approval "Skip" action to properly collapse expanded tool content and show a descriptive preview, matching the behavior of "Reject". Previously, choosing Skip left the full expanded content visible in scrollback and showed a generic "Skipped" label with no content preview.

## Problem Statement

When a user chose "Skip" on an approval prompt for a Write/Edit tool, the UX broke in two ways:

### Pain Points

- The full expanded content (separators + header + file body) remained permanently in terminal scrollback after the decision, because `tea.Println` content is immutable once committed
- The collapsed result showed only a generic `└ Skipped` with no content preview, giving the user no context about what was proposed
- This contradicted the "Reject" flow which properly collapsed and showed a descriptive message with a 10-line preview

## Solution

Two-pronged fix leveraging the existing re-commit mechanism:

1. **Re-commit after approval decision**: After recording the collapsed result in history, trigger `triggerReCommit()` which clears the screen and replays all history items. Since the expanded approval content was never recorded in history (only the collapsed result is), it naturally disappears.

2. **Enable skip preview and descriptive connector**: Removed the early `return false` for skip in `shouldShowApprovalPreview` and added a descriptive connector message (`"User skipped create config.go"`) matching the reject pattern.

## Implementation Details

### render_approval.go

- `shouldShowApprovalPreview`: Removed the `action == "skip"` early return. Skip now shows content previews for Write/Edit/Create tools, same as Reject.
- `buildApprovalConnector`: Added explicit `case "skip"` producing `"└ User skipped {verb} {path}"` with verb and path extracted from the tool display map, matching Reject's descriptive style.

### run_stream_inline_approval.go

- `finalizeApprovalViaBubbletea`: For non-shell tools, replaced the `approvalHideMsg{collapsedResult}` approach with:
  - `approvalHideMsg{}` (clear View() only, no scrollback commit)
  - `recordApproval` (add collapsed result to history)
  - `triggerReCommit()` (ClearScreen + replay all history)

### Test updates

- Updated 5 tests across `render_approval_test.go` and `run_stream_inline_approval_test.go` to verify the new skip behavior: descriptive connector messages and content previews.

## Benefits

- Skip and Reject now have consistent, informative UX
- The user sees what was proposed even after skipping, via a 10-line preview
- No architectural changes needed — reuses the battle-tested re-commit mechanism (Ctrl+O expand/collapse)

## Impact

- All interactive approval flows in the Stigmer CLI
- Both channel-based (Bubbletea owns stdin) and key-reader (legacy) paths benefit from the re-commit fix
- Non-interactive path (--yes/--skip flags) was already correct and unchanged

## Related Work

- Split-commit approval layout (`fix(cli): split approval display into scrollback + live view`)
- Event history and re-commit mechanism (Phase 1 of expand-collapse-tools project)
- HITL reject flow fix (`fix(cli): skip suppression on rejected approvals`)

---

**Status**: Production Ready
