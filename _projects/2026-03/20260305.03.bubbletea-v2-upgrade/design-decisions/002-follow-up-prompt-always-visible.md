# Design Decision 002: Follow-up Prompt Always Visible

**Status**: Accepted
**Date**: 2026-03-05 (Session 5)
**Context**: Bubbletea v2 migration, Phase 4 (Ctrl+O during follow-up)

## Problem

The original T01 plan (influenced by observed Claude Code behavior) proposed hiding the follow-up prompt in expanded mode (Ctrl+O = "read mode") and showing it only in collapsed mode (= "interact mode"). The question: should Ctrl+O during follow-up hide the input, or keep it visible?

## Decision

The follow-up prompt stays visible in both compact and expanded modes. Ctrl+O during follow-up re-commits history in the toggled display mode, but the active text input remains on screen.

## Rationale

1. **User is actively typing**: Hiding the input mid-composition would be disorienting. The user pressed Ctrl+O to see more detail about prior tool calls, not to dismiss their in-progress message.
2. **Input preservation**: The user's partially-typed text stays intact across toggles. No state is lost.
3. **Simpler mental model**: "Ctrl+O toggles tool display density" is a single concept. Adding "...and also hides the prompt if you happen to be typing" creates a mode interaction that's hard to discover and explain.
4. **Implementation simplicity**: The renderer extends its event loop lifecycle for follow-up. Keeping the prompt visible means no special-case teardown/restore of the textinput state on toggle.

## What Changed from the Plan

T01 plan success criteria #4 ("Follow-up prompt hidden in expanded mode, visible in collapsed mode") was updated to reflect this decision. The implementation matches Claude Code's core UX (Ctrl+O toggles display density) without copying the prompt-hiding behavior, which was a secondary observation.

## References

- Checkpoint: `checkpoints/2026-03-05-session-5.md`
- Design decision: `_projects/2026-03/20260305.02.expand-collapse-tools/design-decisions/ctrl-o-during-follow-up-prompt.md`
