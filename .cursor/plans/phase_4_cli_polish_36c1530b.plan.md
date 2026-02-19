---
name: Phase 4 CLI Polish
overview: "Polish the conversational session UX in the Stigmer CLI: fix multi-execution session replay, add stream error recovery in conversational mode, and add a --verbose flag for debugging."
todos:
  - id: stream-error-recovery
    content: Make StreamErrorEvent and handleStreamClosed activate input (instead of going terminal) when FollowUpFn is set, matching Phase 2 pattern
    status: completed
  - id: multi-exec-replay
    content: Fetch all executions in a session for replay, build blocks from each chronologically, show full conversation history
    status: completed
  - id: resumable-replay-decision
    content: "Decide: should completed session replay also allow resuming the conversation (input area at bottom)? Discuss with user before implementing."
    status: completed
  - id: verbose-flag
    content: Add --verbose flag to stigmer run and stigmer draft skill; show execution IDs, phase transitions as system blocks in TUI when enabled
    status: completed
isProject: false
---

# Phase 4: Polish and Edge Cases

## Context

Phases 1-2 established the session abstraction and conversational follow-up TUI. Phase 3 (mid-execution ASK_USER protocol) was intentionally dropped as scope creep. Phase 4 addresses the practical gaps left behind.

## Scope Assessment

Items from the original Phase 4 list, honestly evaluated:

- **Session cleanup/expiry** -- Sessions are server-managed; the CLI has no local session storage. This is a backend concern. **Dropped.**
- **Graceful agent errors within a session** -- Phase 2 already handles this. `DoneEvent` with error activates input when `FollowUpFn` is set. User can send corrective follow-ups after failures. **Already done.**
- `**stigmer get execution` showing session ID** -- Trivial display change. The execution spec already has `session_id`. **Deferred** -- not urgent, no one is asking for it.

That leaves three items worth doing:

---

## Item 1: Multi-Execution Session Replay

**Problem:** `stigmer run <session-id>` on a completed session only replays the latest execution. Since each execution only stores its own turn's messages, the user sees just the last turn -- the entire prior conversation is invisible.

**Fix:** Fetch all executions in the session, build blocks from each in chronological order, concatenate into a single seamless replay.

**Key files:**

- `[run_session.go](client-apps/cli/cmd/stigmer/root/run_session.go)` -- `replayAgentExecution` currently fetches 1 execution; needs to fetch all
- `[replay.go](client-apps/cli/pkg/executiontui/replay.go)` -- `BuildReplayBlocks` takes a single execution; needs a multi-execution variant

**Approach:**

1. In `openSession`, change `PageSize: 1` to fetch all executions in the session
2. For completed sessions, pass the full execution list to a new `BuildSessionReplayBlocks` function
3. `BuildSessionReplayBlocks` iterates executions oldest-first, calls `BuildReplayBlocks` for each, concatenates all blocks
4. No execution boundary markers in the output (Decision 2: hide execution internals)
5. Pass combined blocks to `NewReplay` as before

**Design decision needed:** Should replaying a completed session also allow resuming the conversation (input area at bottom)? This would mean `stigmer run <session-id>` always allows follow-ups, regardless of whether the session is live or completed. This feels like the right UX (Claude Code works this way), but it changes `replayAgentExecution` from using `NewReplay` (read-only) to using the regular `New` model pre-populated with replay blocks. I want to discuss this before implementing.

---

## Item 2: Stream Error Recovery in Conversational Mode

**Problem:** When the gRPC stream disconnects (network issue, server restart), `StreamErrorEvent` sets `done = true` and the TUI is dead. The user must exit and manually run `stigmer run <session-id>` to re-attach. In conversational mode, this breaks the flow unnecessarily.

**Fix:** When `FollowUpFn` is set, treat stream errors like any other terminal event -- activate input instead of going terminal. The user sees the error and can either send a follow-up (creating a new execution in the session) or press Esc to exit.

**Key file:** `[handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)`

**Change in `StreamErrorEvent` handler (~3 lines):**

```go
case StreamErrorEvent:
    m.exitError = e.Err.Error()
    m.finalizeRunningTools()
    m.blocks = append(m.blocks, newErrorBlock(
        renderErrorContent("Stream error: "+e.Err.Error()),
    ))
    if m.cfg.FollowUpFn != nil {
        m.inputActive = true
        m.textarea.Focus()
    } else {
        m.done = true
    }
```

**Same pattern in `handleStreamClosed`:**

```go
func (m Model) handleStreamClosed() (tea.Model, tea.Cmd) {
    if !m.done && !m.inputActive {
        m.exitError = "execution stream closed unexpectedly"
        m.finalizeRunningTools()
        m.blocks = append(m.blocks, newErrorBlock(
            renderErrorContent("Stream closed unexpectedly"),
        ))
        if m.cfg.FollowUpFn != nil {
            m.inputActive = true
            m.textarea.Focus()
        } else {
            m.done = true
        }
        m.refreshViewport()
    }
    return m, nil
}
```

This is consistent with the Phase 2 decision: "all terminal phases activate input." Stream errors are just another way an execution ends.

---

## Item 3: `--verbose` Flag for Execution Debugging

**Problem:** When debugging agent behavior, users have no way to see execution boundaries, IDs, or phase transitions in the TUI. The `--debug` flag dumps zerolog output to stderr, which is useful for CLI internals but not for understanding the agent conversation flow.

**Fix:** Add `--verbose` to `stigmer run` and `stigmer draft skill`. When set, execution-level details appear as system blocks in the TUI transcript.

**What verbose shows:**

- Execution ID when a new execution starts (including follow-ups)
- Phase transitions as they happen
- Session ID in the first system block

**Key files:**

- `[run.go](client-apps/cli/cmd/stigmer/root/run.go)` -- Add `--verbose` flag
- `[draft_skill.go](client-apps/cli/cmd/stigmer/root/draft_skill.go)` -- Add `--verbose` flag
- `[model.go](client-apps/cli/pkg/executiontui/model.go)` -- Add `Verbose bool` to `Config`
- `[handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)` -- Emit system blocks for phase changes when verbose
- `[followup.go](client-apps/cli/pkg/executiontui/followup.go)` -- Emit system block with new execution ID when verbose

---

## What I am NOT including (and why)

- **Automatic reconnection with retry/backoff** -- Complex (block reconciliation on reconnect, retry policies, exponential backoff). Stream error recovery via follow-up is simpler and sufficient. If users request reconnection later, it can be built on top.
- **Session cleanup** -- Server-side concern.
- **Non-interactive mode enhancements** -- No one is asking for this yet.
- `**stigmer get execution` session display** -- Trivial but not urgent.

---

## Implementation Order

Items 1 and 2 are independent and could be done in either order. Item 2 is smallest and cleanest (builds confidence). Item 1 is most impactful. Item 3 depends on understanding the model changes from Items 1-2.

Recommended order: **2 -> 1 -> 3**