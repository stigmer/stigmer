# Fix Tab Navigation for Tool Calls During Input Mode

**Date**: February 25, 2026

## Summary

Fixed a bug where Tab/Shift+Tab navigation through expandable tool call blocks stopped working when the input composer was active — affecting resumed sessions (`stigmer run ses-xxx`) and completed follow-up executions. The input key handler now routes Tab, Shift+Tab, and Enter (for toggle) to the focus navigation system instead of swallowing them into the textarea component.

## Problem Statement

When resuming a session or after an ongoing agent conversation completed, the TUI activated the input composer for follow-up messages. At that point, all keyboard input was routed exclusively to `handleInputKey`, which only handled Esc, Enter, and arrow/page keys. Tab and Shift+Tab fell into the `default` case and were forwarded to the textarea component, where they were silently consumed.

### Pain Points

- Users could not Tab through tool call blocks to inspect results after resuming a session
- Users could not expand/collapse tool calls after a follow-up execution completed
- The footer showed no Tab/focus hints when input was active, giving no indication the feature should be available
- This broke the browsing experience in conversational mode — the primary way users interact with completed executions

## Solution

Added explicit Tab, Shift+Tab, and Enter (for toggle) handling to `handleInputKey` in `input.go`, mirroring the same navigation behavior that exists in `handleNavigationKey`. Updated the footer in `view.go` to show Tab/focus hints when input is active and expandable blocks exist.

## Implementation Details

### `input.go` — Route navigation keys before textarea

- Added `tea.KeyTab` case: calls `focusNextExpandable()`, refreshes viewport, scrolls focused block into view
- Added `tea.KeyShiftTab` case: calls `focusPrevExpandable()`, refreshes viewport, scrolls focused block into view
- Enhanced `tea.KeyEnter` case: when the textarea is empty and a tool block is focused, toggles expand/collapse instead of attempting to submit. When the textarea has content, submits as before

### `view.go` — Show navigation hints in footer

- Updated the `inputActive` footer case to conditionally include `Tab/S-Tab focus  Enter expand` hints when `hasExpandableBlocks()` returns true

### Enter key behavior (dual-purpose)

The Enter key now serves two purposes in input mode, disambiguated by state:
- **Textarea empty + block focused**: Toggle expand/collapse (browsing mode)
- **Textarea has content**: Submit follow-up message (composition mode)

This is safe because the existing code already short-circuits on empty textarea (`message == ""`), so the toggle check simply runs before that existing guard.

## Benefits

- Tool call navigation works identically in all TUI states: live streaming, completed execution, resumed session, and conversational follow-up
- Users can browse and inspect tool results while composing follow-up messages
- Footer hints correctly reflect available actions in every state
- Zero behavioral regression — all 38 existing tests pass unchanged

## Impact

- **CLI users**: Can now Tab through tool calls in resumed sessions and after follow-up completions
- **Conversational mode**: Full browsing capability while the input composer is active
- **No backend changes**: Pure client-side TUI fix

---

**Status**: ✅ Production Ready
