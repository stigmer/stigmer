# Phase 2: Conversational TUI for Agent Sessions

**Date**: February 19, 2026

## Summary

The Stigmer CLI now supports conversational agent sessions. After an agent execution completes (or fails), the input composer activates and the user can send follow-up messages — each one silently creating a new execution within the same session and continuing the conversation in the same viewport. The UI is a two-zone layout: a scrollable transcript on top, a persistent input area at the bottom. The change is fully backward-compatible: without a session ID, the TUI exits on completion exactly as before.

## Problem Statement

The execution TUI was a single-shot viewer. A user would run `stigmer draft skill`, watch the agent work, and when execution completed, the TUI exited. If the generated skill needed refinement, the user had to re-run the entire command from scratch — re-attaching context files, re-typing the message, waiting for a new execution to spin up. There was no continuity between turns.

### Pain Points

- Each iteration required a full command re-invocation with all arguments
- No way to correct or extend agent output without starting a fresh session
- The UX model didn't reflect how agents actually work — conversationally, not in isolated one-shots
- Failed executions silently exited rather than letting the user recover

## Solution

Extend the existing Bubble Tea TUI with:

1. **A persistent input area** (always visible at the bottom, dimmed during streaming, active after completion)
2. **A `FollowUpFn` callback** on `Config` that the TUI calls when the user submits a message — the callback creates the new execution and returns new channels, keeping the TUI fully decoupled from gRPC
3. **Execution state reset on follow-up** — execution-scoped fields reset (phase, streaming, tools, approval) while session-scoped fields persist (blocks, viewport, scroll position)
4. **A mutable active channel layer** (`activeEvents`, `activeApprovals`, `activeCancelFn`) that shadows the immutable `cfg` fields and is swapped when a follow-up starts

The design follows the established `CancelFn` callback pattern already in the codebase and introduces no new dependencies — `bubbles/textarea` is part of the existing `charmbracelet/bubbles v0.20.0`.

## Implementation Details

### New Files

**`pkg/executiontui/followup.go`**

Defines `FollowUpFn` and `FollowUpResult` types, and the handlers for when a follow-up succeeds (`handleFollowUpStarted`) or fails (`handleFollowUpError`). On success, channels are swapped, execution-scoped state is reset, and event listening resumes. On failure, the error is shown in the transcript and the input reactivates so the user can retry.

**`pkg/executiontui/input.go`**

Owns the input area rendering and key handling. `hasInputArea()` gates layout changes on whether `FollowUpFn` is configured. `renderInputArea()` renders the separator and either the focused textarea or a dimmed "Agent is working..." placeholder. `handleInputKey()` routes Esc (exit), Enter (submit if non-empty), and all other keys to the textarea. `executeFollowUpCmd()` wraps the async `FollowUpFn` call as a `tea.Cmd`.

### Modified Files (TUI package)

**`model.go`** — Added `FollowUpFn` to `Config`; added `textarea.Model`, `inputActive bool`, `activeEvents`, `activeApprovals`, `activeCancelFn`, `latestExecutionID` to `Model`; `New()` initializes all mutable channel fields from `cfg`; `Init()` uses `activeEvents`; added `LatestExecutionID()` accessor.

**`view.go`** — `View()` inserts the input area between viewport and footer when `hasInputArea()` is true; footer gains an `inputActive` case showing "Enter send  Esc exit"; doc comment updated for new priority order.

**`update.go`** — Key routing: `ctrl+c` always quits first, then `inputActive` gates to `handleInputKey` (capturing all keys including those with special meaning like `q`, `c`, `a`, `s`, `r`), then existing handlers unchanged. `handleWindowSize` reserves `inputAreaHeight` lines when conversational mode is active and sets textarea width. Activity tick stops when `inputActive` to avoid wasted cycles. Unhandled messages forwarded to textarea (for cursor blink) when active.

**`handle_events.go`** — `DoneEvent`: when `FollowUpFn` is set, sets `inputActive = true` and focuses textarea instead of `done = true`. This applies to all terminal phases (completed, failed, cancelled) — the user can recover from failures by sending corrective instructions. When `FollowUpFn` is nil, behavior is unchanged. `handleStreamClosed`: treats closure as expected when `inputActive` (the execution completed normally). Dispatches `followUpStartedMsg` and `followUpErrorMsg`.

**`messages.go`** — Added `followUpStartedMsg` and `followUpErrorMsg` internal message types.

**`approval.go`** — Uses `m.activeApprovals` instead of `m.cfg.ApprovalResponses` so approval responses go to the correct execution's channel after a follow-up.

**`help.go`** — Added "Conversation" section (Enter to send, Esc to exit).

**`doc.go`** — Updated package-level documentation to describe conversational mode and when `FollowUpFn` should be set.

### Modified Files (CLI command layer)

**`run_stream.go`** — `streamAgentExecution` gains an `orgID` parameter; builds a `FollowUpFn` closure via `buildFollowUpFn` when `sessionID` is non-empty; uses `result.LatestExecutionID()` to fetch the correct final execution after the TUI exits (which may be a follow-up, not the original).

`buildFollowUpFn` is a standalone function that: creates the new execution via `createAgentExecution(SessionID: ...)`, subscribes to its gRPC stream, launches a `streamToEvents` goroutine with the new channels, and returns a `FollowUpResult`. It reuses `createAgentExecution` and `streamToEvents` without modification.

**`run_handlers.go`**, **`draft_skill_handler.go`**, **`run_session.go`** — Threaded `orgID` through to `streamAgentExecution`. No logic changes.

### Key Design Invariants

| Invariant | How preserved |
|-----------|---------------|
| Backward compatibility | `FollowUpFn` is optional; nil = pre-Phase 2 behavior exactly |
| TUI decoupled from gRPC | `FollowUpFn` returns channels, not a stream; TUI never imports gRPC packages |
| Channel safety | `activeApprovals` replaces `cfg.ApprovalResponses` so approval responses never go to a stale channel |
| Conversation continuity | `blocks` and viewport are session-scoped and preserved across follow-ups |
| Workflow execution | Completely untouched — inline spinner path, no session, no conversation |
| `--detach` mode | `streamAgentExecution` is never called in detach mode; `FollowUpFn` is never set |

### State Reset on Follow-Up

When `followUpStartedMsg` arrives, these fields reset (execution-scoped):

```
phase → "pending"
streaming → nil
runningTools → map{}
approval → nil
inputActive → false
done → false
exitError → ""
thinkingVisible → false
lastEventAt → now
cancelling → false
cancelConfirm → false
```

These fields persist (session-scoped): `blocks`, `viewport`, `focusedBlockIndex`, `autoScroll`, `width`, `height`, `ready`, `cfg`, `latestExecutionID` (updated to new ID).

## Benefits

- **Zero friction follow-ups**: Users can refine agent output without re-running commands
- **Failure recovery**: Failed executions activate the input instead of exiting — "that failed because the schema path was wrong, try `/api/v1/agent.proto`" becomes natural
- **No new dependencies**: `bubbles/textarea` ships with the existing `charmbracelet/bubbles v0.20.0`
- **No backend changes needed**: `createAgentExecution(SessionID: ...)` already creates follow-up executions; the backend handles context continuity
- **Stable layout**: The input area is always visible (dimmed placeholder during streaming), avoiding jarring layout shifts when execution completes
- **Preserves all existing behavior**: Cancel, approval, help overlay, scroll, Tab/Enter block expansion — all unchanged when `inputActive` is false

## Impact

- **Users of `stigmer run <agent>`**: Gain conversational follow-ups after each execution
- **Users of `stigmer draft skill`**: Gain the ability to iterate on generated skills in the same session; artifact download continues from the first execution for MVP
- **Users of `stigmer run <session-id>`**: Re-attachment gains conversational follow-ups when re-attaching to completed sessions
- **Workflow execution users**: No change — the workflow path is completely untouched
- **Callers of `streamAgentExecution`**: `orgID` parameter added; all three call sites updated

## Related Work

- [Phase 1: Session-Centric Execution Flow](../2026-02/) — Commit `726333b1`: replaced execution IDs with session IDs in the TUI; introduced `CreateAgentExecutionInput`; established the session abstraction this phase builds on
- Phase 3 (future): "Ask User" protocol — agents asking questions mid-execution via a new gRPC event type; the `inputActive` state machine and channel-swap pattern established here are designed to accommodate this

---

**Status**: ✅ Production Ready
**Timeline**: Single session, February 19, 2026
