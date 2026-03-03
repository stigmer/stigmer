# Expandable HITL Approval Content in CLI

**Date**: March 3, 2026

## Summary

Removed backend-imposed content truncation from HITL approval messages and implemented expandable content blocks in the CLI TUI, ensuring users can review the full sanitized tool arguments before approving agent actions. This separates the concern of security sanitization (backend) from display presentation (CLI), a key architectural improvement.

## Problem Statement

When agents requested approval for tool executions (especially shell commands), the approval message displayed in the CLI was truncated, preventing users from seeing the complete command or arguments they were being asked to approve.

### Pain Points

- Backend `sanitize_value()` in `status_builder.py` hard-truncated strings at 200 characters and lists at 10 items, discarding information before it reached the CLI
- The CLI event pipeline pre-formatted raw JSON arguments via `approval.FormatArgs()` before sending them to the TUI, preventing proper multi-line command rendering
- No mechanism existed in the TUI for users to expand or collapse approval content
- Users were forced to approve commands they could not fully inspect — a security and trust concern

## Solution

A three-layer fix applying strict separation of concerns:

1. **Backend**: Remove all content truncation from `sanitize_value()`, retaining only security sanitization (secret redaction, env-var resolution, platform-ref humanization)
2. **CLI event pipeline**: Pass raw sanitized JSON to the TUI instead of pre-formatting it
3. **CLI TUI rendering**: Implement smart preview/full rendering with expandable content blocks

## Implementation Details

### Backend — `status_builder.py`

Removed the 200-character string truncation and 10-item list truncation from `_create_args_preview()`. The backend now focuses exclusively on security sanitization: redacting secrets, resolving display environment variables, and humanizing platform references. All display decisions are deferred to the CLI.

### CLI Event Pipeline — `run_stream_events.go`

Removed the `approval.FormatArgs()` call from `emitAndWaitApproval()`. The `ArgsPreview` field now carries raw sanitized JSON through the gRPC event stream to the TUI, giving the rendering layer full control over presentation.

### CLI TUI Rendering — `render_approval.go`

Replaced `renderApprovalPrompt()` with `renderApprovalContent()` returning a `(preview, full)` tuple:

- **Shell tools**: Parses JSON to extract `command` and secondary args. Commands exceeding 5 lines produce a compact preview (first line + "+N more lines" indicator) alongside the full expanded view.
- **Generic tools**: Formats arguments as key-value lines. More than 5 argument lines triggers a preview showing the first 3 lines with an expansion indicator.

### Expandable Block Model — `blocks.go`

Updated `newApprovalBlock()` to accept `(preview, full)` and create an expandable `contentBlock` when they differ. Expandable approval blocks default to expanded state — users must see what they are approving.

### Footer Navigation Hints — `view.go`

Added contextual navigation hints (`↑↓ scroll  Tab focus  Enter expand`) to the approval footer when expandable blocks are present, guiding users to the expand/collapse interaction.

### Tests — `approval_test.go`, `render_blocks_test.go`

Updated existing tests and added four new test cases covering expandable and non-expandable scenarios for both shell and generic tool approvals.

## Benefits

- **Full transparency**: Users can now inspect the complete sanitized content of any tool call before approving
- **Clean architecture**: Backend handles security, CLI handles presentation — no cross-cutting display logic in the backend
- **Scalable pattern**: The expandable block pattern can be reused for other content types (tool output, logs, etc.)
- **Better UX**: Smart previews keep the TUI compact while making full content one keypress away

## Impact

- **End users**: Can now make fully informed approval decisions for agent tool calls
- **Backend**: Simpler `sanitize_value()` with no display concern leakage
- **CLI TUI**: New expandable content block primitive available for future use
- **Test coverage**: New unit tests for the preview/full rendering logic

## Files Changed

| File | Change |
|------|--------|
| `backend/services/agent-runner/worker/activities/graphton/status_builder.py` | Remove string/list truncation |
| `client-apps/cli/cmd/stigmer/root/run_stream_events.go` | Pass raw JSON to TUI |
| `client-apps/cli/pkg/executiontui/render_approval.go` | New preview/full rendering |
| `client-apps/cli/pkg/executiontui/blocks.go` | Expandable approval blocks |
| `client-apps/cli/pkg/executiontui/handle_events.go` | Wire new rendering |
| `client-apps/cli/pkg/executiontui/view.go` | Navigation hints in footer |
| `client-apps/cli/pkg/executiontui/approval_test.go` | New expandable tests |
| `client-apps/cli/pkg/executiontui/render_blocks_test.go` | Updated assertions |

## Related Work

- [2026-03-01-055943](2026-03-01-055943-fix-approval-ux-context.md) — Fix approval UX context
- [2026-03-02-032821](2026-03-02-032821-improve-execute-tool-approval-ux.md) — Improve execute tool approval UX
- [2026-03-02-034718](2026-03-02-034718-humanize-platform-paths-in-approval-display.md) — Humanize platform paths in approval display
- [2026-03-03-082920](2026-03-03-082920-humanize-toolcall-args-in-fresh-creation-path.md) — Humanize ToolCall args in fresh-creation path

---

**Status**: ✅ Production Ready
