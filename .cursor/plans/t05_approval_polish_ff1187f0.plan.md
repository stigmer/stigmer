---
name: T05 Approval Polish
overview: Enhance the TUI approval prompt with better args formatting (using the existing `approval.FormatArgs`), wire the `Comment` field end-to-end (empty string on reject, future-proofed), improve the approval confirmation block rendering, and add comprehensive approval-focused tests. No text input, no two-phase flow — single-key a/s/r stays as-is.
todos:
  - id: format-args
    content: "Format approval args at boundary: call approval.FormatArgs in run_stream_events.go before sending ApprovalNeededEvent"
    status: completed
  - id: wire-comment
    content: "Wire Comment field: add to ApprovalResponse, pass through mapApprovalResponseToDecision"
    status: completed
  - id: confirmation-block
    content: "Improve approval confirmation block: add renderApprovalConfirmation helper with action+toolName+styling"
    status: completed
  - id: approval-tests
    content: "Create approval_test.go with comprehensive tests: all 3 actions, response verification, confirmation blocks, sequential approvals"
    status: completed
  - id: verify-build
    content: "Verify: go vet, go test (all pass), go build, file size limits"
    status: completed
isProject: false
---

# T05: Approval Prompt Enhancement

## What Changes and Why

The core approval flow (a/s/r single-key capture, channel-based response, inline rendering) already works from T02. T05 is about closing gaps: the args are displayed as raw JSON, the `Comment` field isn't wired through the response chain, the confirmation block is a plain string, and approval-specific test coverage is thin.

## Scope (4 changes, ~80-100 lines net new)

### 1. Format approval args at the boundary

**Problem:** `renderApprovalPrompt` dumps `argsPreview` as raw JSON (`{"command":"rm -rf /tmp"}`) instead of the human-readable format that `approval.FormatArgs` already provides (`Command: rm -rf /tmp` with bold styling for known tools, red for dangerous ones).

**Fix:** Call `approval.FormatArgs(toolName, argsPreview)` in `[run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)` before sending the `ApprovalNeededEvent`. The TUI stays independent of `pkg/approval` — formatting happens at the boundary.

- File: `run_stream_events.go` — ~2 lines changed in `emitAndWaitApproval`
- Import: add `approval` (already imported transitively in the package)

### 2. Wire `Comment` through `ApprovalResponse`

**Problem:** `ApprovalResponse` has no `Comment` field. `mapApprovalResponseToDecision` in `[run_stream_convert.go](client-apps/cli/cmd/stigmer/root/run_stream_convert.go)` creates `approval.Decision` without passing a comment. The backend API `SubmitApprovalInput` supports `Comment` but it's always empty.

**Fix:**

- Add `Comment string` to `ApprovalResponse` in `[events.go](client-apps/cli/pkg/executiontui/events.go)` (~1 line)
- Pass `Comment: resp.Comment` in `mapApprovalResponseToDecision` in `run_stream_convert.go` (~1 line)
- Set `Comment: ""` in `handleApprovalKey` in `[approval.go](client-apps/cli/pkg/executiontui/approval.go)` (already empty string by Go zero value, but explicit for clarity)

This is future-proofing: when/if we add a rejection reason later, the plumbing is ready.

### 3. Improve approval confirmation block

**Problem:** After approval, the confirmation block says `"Approval decision: approve"` — a flat, unstyled string. It doesn't echo what tool was approved/rejected, making the execution history less scannable.

**Fix:** Enhance the confirmation block in `handleApprovalKey` in `[approval.go](client-apps/cli/pkg/executiontui/approval.go)` to include the tool name and use appropriate styling:

- Approve: `"Approved: shell"` (green/success style)
- Skip: `"Skipped: shell"` (yellow/warning style)  
- Reject: `"Rejected: shell"` (red/error style)

New helper: `renderApprovalConfirmation(action, toolName string) string` in `[render_blocks.go](client-apps/cli/pkg/executiontui/render_blocks.go)` (~15 lines)

### 4. Comprehensive approval tests

**Problem:** Existing approval tests in `update_test.go` cover the basics (enter state, key sends response, focus isolation, g/G isolation) but miss:

- All three actions (a, s, r) individually verified
- Response content verification (action string + toolCallID)
- Confirmation block content verification
- Approval block rendering tests
- Multiple sequential approvals

**Fix:** New file `[approval_test.go](client-apps/cli/pkg/executiontui/approval_test.go)` (~120-150 lines) with focused approval tests. Keeps `update_test.go` from growing further (already 1016 lines).

## Files Changed


| File                                | Change                                                   | Delta      |
| ----------------------------------- | -------------------------------------------------------- | ---------- |
| `pkg/executiontui/events.go`        | Add `Comment` to `ApprovalResponse`                      | +1 line    |
| `pkg/executiontui/approval.go`      | Explicit Comment field, use `renderApprovalConfirmation` | ~+5 lines  |
| `pkg/executiontui/render_blocks.go` | Add `renderApprovalConfirmation` helper                  | ~+15 lines |
| `pkg/executiontui/view.go`          | No changes needed (footer already adapts)                | 0          |
| `cmd/.../run_stream_events.go`      | Format args with `approval.FormatArgs`                   | ~+3 lines  |
| `cmd/.../run_stream_convert.go`     | Pass `Comment` in decision mapping                       | ~+1 line   |
| `pkg/executiontui/approval_test.go` | New: comprehensive approval tests                        | ~130 lines |


**Estimated total:** ~155 lines added, all files stay under 250 lines.

## What We Are NOT Doing (and Why)

- **No rejection reason text input** — adds friction for rare action with minimal value. Backend gets empty comment. Future-proofed if we change our mind later.
- **No `textinput` dependency in executiontui** — not needed without rejection reason input.
- **No changes to `pkg/approval/` package** — we reuse `FormatArgs` from it at the boundary, but don't modify it.
- **No changes to the approval event structure** — `ApprovalNeededEvent` fields are sufficient.

## Verification

- `go vet ./pkg/executiontui/...` clean
- `go test ./pkg/executiontui/... -count=1` — all existing 75 tests pass + new approval tests
- `go build ./cmd/stigmer/...` clean
- All source files under 250 lines

