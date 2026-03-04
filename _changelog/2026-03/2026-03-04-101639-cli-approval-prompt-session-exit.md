# CLI Approval Prompt Session Exit

**Date**: March 4, 2026

## Summary

Added a clean session exit path from approval prompts in the Stigmer CLI. Both Escape and Ctrl+C now exit the session and cancel the backend execution, with a resume hint printed so the user can return later. Previously, these keys silently auto-skipped the tool and the session continued — giving the user no way to leave.

## Problem Statement

When Stigmer asked the user for tool approval, the user had no way to exit the session from the approval prompt. Both Escape and Ctrl+C triggered `ErrPromptCancelled`, which `handlePromptError` converted to an auto-skip — the tool was silently skipped and the session marched forward.

### Pain Points

- No exit path existed from the approval prompt — pressing Escape appeared to "not work" because the session continued
- The feedback message `"Approval prompt failed: prompt cancelled by user — auto-skipping"` used alarming "failed" language for an intentional user action
- The hint text `arrows/1-3/enter/esc` listed keys without explaining their effects
- Having Escape mean "skip" was redundant — Skip was already an explicit menu option (choice 2)

## Solution

Both Escape and Ctrl+C now trigger `ErrSessionExit`, which performs a clean session exit: unblocks the stream goroutine, cancels the backend execution via `execution.Cancel()` in a fire-and-forget goroutine, and terminates the render loop. The session ID is printed so the user can resume later.

The three menu options (Yes/Skip/Reject) remain the tool-call decisions. Session lifecycle is orthogonal — Esc/Ctrl+C in the hint bar is the correct affordance for exit, similar to Claude Code's `Esc to cancel`.

## Implementation Details

**New sentinel error** (`pkg/approval/prompter.go`): `ErrSessionExit` distinguishes session exit from legacy `ErrPromptCancelled` (retained for backward compatibility).

**InlinePrompter** (`pkg/approval/inline_prompter.go`): Both `keyEsc` and `keyCtrlC` return `ErrSessionExit`. Hint text updated to `↑↓/1-3 select · esc/ctrl+c exit`.

**Bubbletea promptModel** (`pkg/approval/prompt_model.go`): Removed the `cancelled` field (dead code). Both `"esc"` and `"ctrl+c"` in selection phase set `sessionExit = true`. Comment phase Esc retains its sub-action cancel behavior (skip the comment, submit rejection without reason). Hint text: `↑↓ move · enter select · esc/ctrl+c exit`.

**Renderer config** (`cmd/stigmer/root/run_stream_inline.go`): Added `cancelExecFn func()` to `inlineRenderConfig` and `exitRequested bool` to `inlineRenderer`. After `handleApproval` returns, `handleEvent` checks `exitRequested` and returns a terminal `"cancelled"` phase.

**Session exit handler** (`cmd/stigmer/root/run_stream_inline_approval.go`): New `handleSessionExit` method sends a skip response to unblock the stream goroutine, fires `cancelExecFn()` in a goroutine, prints exit and resume messages, and sets `exitRequested`. The fallback path in `handlePromptError` handles unexpected errors (context cancellation) with a neutral auto-skip message.

**Cancel function wiring** (`cmd/stigmer/root/run_stream.go`, `run_stream_inline_followup.go`): Initial `cancelExecFn` closure created in `streamAgentInline` calling `execution.Cancel(conn, executionID)`. Updated on follow-ups from `FollowUpResult.CancelFn`.

## Benefits

- Users can now exit a session from any approval prompt using Escape or Ctrl+C
- Backend execution is cancelled on exit, preventing wasted resources
- Resume hint (`stigmer run ses-xxxxx`) enables returning to the session later
- Hint text clearly communicates available actions at every prompt
- Removed redundant Escape = skip behavior, simplifying the mental model

## Impact

- **End users**: Clear exit path from approval prompts; no more "stuck" feeling
- **Backend**: Execution is properly cancelled on user exit instead of continuing to run
- **Codebase**: Cleaner prompt model (removed dead `cancelled` field); consistent behavior between InlinePrompter and Bubbletea InteractivePrompter

## Related Work

- Inline-first CLI project (`20260304.02.inline-first-cli`): This builds on the approval rendering from Phase 3.3
- Multi-workspace polish project (`20260304.03`): Shares the `feat/cli-tui-ux-hardening` branch

---

**Status**: ✅ Production Ready
