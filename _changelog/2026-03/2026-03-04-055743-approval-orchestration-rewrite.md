# Approval Flow Orchestration — Expand / Prompt / Collapse / Suppress

**Date**: March 4, 2026

## Summary

Rewrote the CLI's tool approval flow to deliver a Claude Code-inspired interactive experience: the user sees an expanded view of the tool call content, makes a decision via arrow-key menu, and the expanded view collapses into a compact one-line result. Write/edit/delete completions are suppressed post-approval since their outcome is already represented in the collapsed result.

## Problem Statement

The previous `handleApproval` implementation was a monolithic function embedded in the event dispatch file. It lacked cursor-control integration, could not erase the expanded view after a decision, and produced redundant ToolCompletedEvent output for tools whose result was already shown in the approval collapse.

### Pain Points

- No visual collapse — expanded approval content remained in scrollback permanently, cluttering the terminal
- No integration with `InlinePrompter` — the interactive prompter's line count was unused, preventing precise cursor control
- Redundant output — approved write/edit tools printed both a collapsed approval result and a subsequent completed badge
- `renderToolWaitingApproval` produced visual output prematurely, before `handleApproval` could control the rendering lifecycle
- Monolithic orchestration mixed event state management, rendering, prompting, and suppression logic in one function

## Solution

Extracted approval orchestration into a dedicated file (`run_stream_inline_approval.go`) with clearly separated responsibilities: context resolution, expanded view construction, prompt invocation, collapsed result rendering, and completion suppression tracking. The interactive flow uses `termctl.EraseLines` for precise cursor control to collapse the expanded view and prompt menu after the user's decision.

## Implementation Details

### New file: `run_stream_inline_approval.go` (216 lines)

Nine functions composing the approval orchestrator:

- **`handleApproval`** — Entry point. Dispatches to interactive or non-interactive path based on `defaultAction`.
- **`handleNonInteractiveApproval`** — Fast path: erases running line, prints collapsed result. No expanded view.
- **`handleInteractiveApproval`** — Full flow: erase running line → print expanded view → prompt → erase expanded+menu → print collapsed result.
- **`resolveApprovalContext`** — Looks up `waitingApprovalState` saved by `renderToolWaitingApproval`. Falls back to building context from `ApprovalNeededEvent` data when state is missing.
- **`buildExpandedView`** — Composes header + separator + content + separator. Returns the string and its line count for collapse.
- **`promptForDecision`** — Type-asserts prompter to `*InlinePrompter` for `PromptWithLineCount` (returns line count). Falls back to generic `Prompter.Prompt` with lineCount=0.
- **`handlePromptError`** — Converts prompt errors to reject decisions with error context in comment.
- **`printCollapsedResult`** — Renders `RenderApprovalResult`, applies `GutterWrap` for sub-agent context, writes to status output.
- **`trackSuppression`** — Records tool ID in `suppressedToolIDs` for approved/skipped write/edit/delete tools.

### State management in `run_stream_inline.go`

- `waitingApprovalState` struct: holds `ToolCallInfo`, `subAgentID`, `runningLineRendered` between `ToolWaitingApprovalEvent` and `ApprovalNeededEvent`
- `suppressedToolIDs` map: tracks tool IDs whose `ToolCompletedEvent` should be silently dropped
- `lastRenderedRunningID`: enables accurate running-line erasure
- `renderToolWaitingApproval` becomes silent — saves state only, all visual output deferred to `handleApproval`
- Pre-switch interception in `handleEvent` checks `suppressedToolIDs` to drop write/edit/delete completions

### Rendering additions in `render_approval.go`

- `ExpandedApprovalHeader(tc, opts)` — Green bullet header for the pre-decision expanded view
- `ExpandedApprovalContent(tc)` — Full display content extracted from tool args/result
- `ShouldSuppressCompletion(toolName)` — Predicate: true for write/edit/create/delete, false for shell

### Prompter call site switching

- `run_agent_exec.go` and `run_session.go` conditionally instantiate `NewInlinePrompter(os.Stdin, os.Stderr)` for inline output mode, `NewInteractivePrompter()` otherwise

## Benefits

- **Clean terminal experience**: Expanded approval content collapses after decision, leaving only a compact one-line result in scrollback
- **No redundant output**: Approved write/edit/delete tools no longer produce both a collapsed result and a completed badge
- **SRP compliance**: Approval orchestration (~216 lines) cleanly separated from event dispatch, each file has one reason to change
- **Graceful degradation**: Non-TTY environments skip cursor control; non-InlinePrompter contexts fall back to generic prompt
- **Testable**: 38 new tests covering interactive/non-interactive paths, suppression, sub-agent gutter-wrapping, and error recovery

## Impact

- **End users**: Approval interactions feel polished — content appears for review, then cleanly collapses to a one-line summary. No scrollback clutter.
- **Maintainers**: Approval logic is self-contained in one file with clear function boundaries. Adding new approval behaviors (Phase 3.4 shell streaming) requires changes in one file.
- **Architecture**: Establishes the pattern for cursor-controlled UI state transitions that Phase 3.4 (shell streaming) and Phase 4 (thinking spinner) will build upon.

## Related Work

- Phase 3.0: `pkg/termctl` primitives (`EraseLines`, `DisplayRows`) — foundation for cursor control used here
- Phase 3.1: `InlinePrompter` with `PromptWithLineCount` — the prompt mechanism orchestrated here
- Phase 3.2: `RenderApprovalResult`, `ApprovalSeparator`, `ApprovalQuestion` — rendering building blocks composed here
- Phase 3.4 (next): Shell tool approval variant + ToolStreamDeltaEvent streaming

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~2 hours)
