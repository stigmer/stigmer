# Fix Approval UX: Surface What the User is Approving

**Date**: March 1, 2026

## Summary

Activated dead-code approval rendering and threaded sub-agent context through the approval pipeline so the TUI now shows a contextual "APPROVAL REQUIRED" block in the viewport -- with tool name, arguments, message, and sub-agent origin -- instead of only bare `[a]/[s]/[r]` action keys in the footer. Also fixed a blind spot where `findToolCallByID` could not locate sub-agent tool calls.

## Problem Statement

When a tool call required approval, the TUI showed only the footer `[a] Approve [s] Skip [r] Reject [q] Detach` with zero context about what was being approved. For sub-agent tool calls, the problem was compounded: the tool call lived in `SubAgentExecution.ToolCalls` (not the top-level list), so the bridge layer could not even look it up for richer context.

### Pain Points

- **Context-free approval prompt**: The user had to hunt through the viewport for a tool block with a pause badge to understand what needed approval
- **Dead rendering code**: `renderApprovalPrompt` and `renderApprovalConfirmation` existed, were tested, but were never called in production
- **Sub-agent context dropped**: The `PendingApproval` proto carried `from_sub_agent` and `sub_agent_name`, but the CLI bridge ignored them
- **Blind `findToolCallByID`**: Only searched top-level `ToolCalls`, returning nil for sub-agent tool calls

## Solution

Wire the existing `renderApprovalPrompt` into the event handler, thread sub-agent context through the full pipeline, and fix the tool call lookup to search sub-agent scopes.

## Implementation Details

### TUI Event Layer (3 files)

- **`events.go`**: Added `FromSubAgent bool` and `SubAgentName string` to `ApprovalNeededEvent`
- **`model.go`**: Added `approvalBlockIdx int` field (initialized to -1) to track the approval context block for lifecycle management
- **`handle_events.go`**: `ApprovalNeededEvent` handler now creates a `blockApproval` via `renderApprovalPrompt` and appends it to the viewport

### TUI Rendering (2 files)

- **`render_approval.go`**: `renderApprovalPrompt` now accepts sub-agent context and shows `(sub-agent: name)` when present; removed duplicate inline action keys (footer owns those)
- **`view.go`**: Approval footer now includes the tool name: `[a] Approve (Write) [s] Skip [r] Reject [q] Detach`

### TUI Interaction (1 file)

- **`approval.go`**: When the user responds (a/s/r), the approval block is replaced in-place with a compact confirmation line via `renderApprovalConfirmation` (also previously dead code)

### Bridge Layer (2 files)

- **`run_stream_events.go`**: `extractApprovalInfo` returns a structured `approvalInfo` that includes `fromSubAgent` and `subAgentName` from the `PendingApproval` proto
- **`run_stream_convert.go`**: `findToolCallByID` now searches `SubAgentExecution.ToolCalls` as a fallback when the tool call is not found at the top level

### Tests (2 files)

- Updated 2 existing tests for the new `renderApprovalPrompt` signature
- Added 8 new tests: approval block creation, confirmation replacement (approve/skip/reject), sub-agent context rendering, footer tool name

## Benefits

- Users can immediately see what tool, what arguments, and which sub-agent is requesting approval
- Sub-agent approvals are no longer a blind spot -- full context is surfaced
- Two previously dead rendering functions (`renderApprovalPrompt`, `renderApprovalConfirmation`) are now active and serving their intended purpose
- No proto changes required -- all data was already on the wire, just not consumed

## Impact

- **CLI users**: Dramatically improved approval experience during `stigmer run` sessions, especially with sub-agent delegation
- **10 files changed** across TUI, bridge, and tests (all Go, CLI-only)
- **Zero backend changes** -- purely a CLI-side wiring fix

## Related Work

- Builds on the sub-agent header block UX added in the same session (expandable `🔀` blocks)
- Uses the same `PendingApproval` proto fields (`from_sub_agent`, `sub_agent_name`) that the backend already populates

---

**Status**: ✅ Production Ready
