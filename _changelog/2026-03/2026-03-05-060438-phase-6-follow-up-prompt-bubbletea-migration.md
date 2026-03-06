# Phase 6: Follow-up Prompt Migration to Bubbletea View()

**Date**: March 5, 2026

## Summary

Migrated the follow-up prompt (the conversational input shown between executions) from direct stderr writes with manual `termctl.EraseLines` erasure to Bubbletea's `View()` rendering. This eliminates the last `EraseLines` call site in the Bubbletea code path, completing the rendering migration for all inline renderer UI components.

## Problem Statement

The follow-up prompt — the separator, hint, and `>` marker shown after an execution completes — was the last piece of inline renderer UI that still used `termctl.EraseLines` when a Bubbletea program was running. After Phases 2-5 migrated the spinner, approval panel, and streaming content to `View()`, the follow-up prompt remained as a direct-write + manual-erase holdout.

### Pain Points

- Inconsistency: all other dynamic UI elements rendered through Bubbletea, but the follow-up prompt bypassed it
- The `EraseLines(followUpPromptRows)` approach hardcodes a row count (4) that doesn't account for terminal soft-wrapping — the same class of bug the entire Bubbletea migration is designed to eliminate
- The monolithic `readFollowUpInput` function mixed prompt rendering with stdin I/O, making neither reusable

## Solution

Follow the same message/model/handler/View pattern established in Phases 2-5:

1. **New message types**: `followUpShowMsg` (activate prompt in View) and `followUpHideMsg` (clear prompt, commit styled message via `tea.Println`)
2. **View() priority chain** extended: `approval > streaming > followUp > spinner > empty`
3. **Clean function decomposition**: the monolithic `readFollowUpInput` split into `formatFollowUpPrompt` (pure string builder), `readStdinLine` (stdin I/O), and `readFollowUpInputDirect` (compose both for direct-write fallback)
4. **Branching pattern**: `promptFollowUp` routes to `promptFollowUpViaBubbletea` or `promptFollowUpDirect` based on `program != nil`

## Implementation Details

### Files Changed (4 files, +266/-32 lines)

- `run_stream_inline_bubbletea.go` (+47): message types, model fields, handlers, View() branch
- `run_stream_inline_followup.go` (+63 net): function decomposition, Bubbletea/direct branching
- `run_stream_inline_bubbletea_test.go` (+136): 9 new tests (model state, View priority, prompt format)
- `run_stream_inline_followup_test.go` (+20/-20): renamed references for `readFollowUpInputDirect`

### Key Pattern: Consistent with Phases 4-5

The branching in `promptFollowUp` mirrors the approval flow's `promptApprovalViaBubbletea`/`promptApprovalDirect` split and the streaming flow's message-based approach. The `followUpHideMsg` handler follows the same `tea.Println(styledMessage)` Cmd pattern used by `approvalHideMsg` and `streamingHideMsg`.

## Benefits

- **All `termctl.EraseLines` calls unreachable in the Bubbletea path**: the inline renderer uses zero manual cursor manipulation when a Bubbletea program is active
- **Cleaner function decomposition**: `formatFollowUpPrompt` is a pure, testable function; `readStdinLine` is reusable I/O; the branching is explicit and well-documented
- **Foundation for stdin ownership**: the next project (20260305.02, expand-collapse-tools) will have Bubbletea own stdin, at which point the follow-up prompt can receive keystrokes through `Update()` instead of terminal echo — fully resolving the soft-wrap edge case

## Impact

- **CLI users**: no visible change — the follow-up prompt looks and behaves identically
- **Codebase**: completes the "all dynamic UI through Bubbletea View()" migration goal for Phases 1-6
- **Next project**: unblocks the expand-collapse-tools project, which lists Phase 6 as a prerequisite

## Related Work

- Phase 1: Bubbletea Program Shell (Session 1)
- Phase 2: Spinner Migration (Session 2)
- Phase 3: Header Simplification (Session 3)
- Phase 4: Approval Flow Migration (Session 4)
- Phase 5: Tool Streaming Migration (Session 5)
- Phase 7: Cleanup (next)
- Project 20260305.02: Expand/Collapse Tools (blocked on Phase 7 completion)

---

**Status**: Production Ready
**Timeline**: 1 session (~30 minutes)
