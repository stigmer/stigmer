---
name: Fix Approval UX Flow
overview: "Fix two distinct problems in the CLI agent execution experience: (1) redundant/confusing phase change messages displayed after the user has already handled an approval, and (2) investigate the \"at least one message is required\" Anthropic API error that occurs when the agent runner resumes from a LangGraph checkpoint after approval."
todos:
  - id: fix-redundant-phase-msgs
    content: Suppress redundant phase change messages after approval in run_stream.go by updating lastPhase after handling approvals in Steps 2 and 3
    status: completed
  - id: resume-aware-display
    content: "Make displayAgentPhaseChange in run_display.go resume-aware: suppress WAITING_FOR_APPROVAL display entirely, show 'Resumed' instead of 'Execution started' when transitioning from WAITING_FOR_APPROVAL to IN_PROGRESS"
    status: completed
  - id: sanitize-error-display
    content: Add error sanitization in run_display_stream.go to prevent raw API errors (like Anthropic 400 responses) from leaking to CLI users
    status: completed
  - id: add-tests
    content: Add/update tests for phase display changes and error sanitization
    status: completed
  - id: investigate-checkpoint-resume
    content: "Investigate the 'messages: at least one message is required' backend bug -- check agent runner logs, checkpoint store state, and LangGraph resume behavior (collaborate with user before implementing fix)"
    status: completed
isProject: false
---

# Fix CLI Approval UX and Post-Approval Resume Error

## Problem Analysis

Looking at the log output, here is the exact sequence the user sees today and what is wrong with it:

```
✓ Tool execution approved              <-- User approved the tool (good)
⚠ ⏸️  Approval required                <-- REDUNDANT: phase change display fires AFTER approval was already handled
✓ ▶️  Execution started                <-- REDUNDANT: phase transitions back to IN_PROGRESS, shows "started" again
⠦ Agent is working... ℹ️  ❌ Error...  <-- BUG: raw Anthropic API error leaks to user
✗ ❌ Execution failed                  <-- Terminal phase
```

There are **two independent problems** here that should be addressed separately.

---

## Problem 1: Redundant Phase Messages After Approval (CLI-only fix)

### Root Cause

In `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)`, the streaming loop has 5 steps executed in order on each stream update:

1. Step 2 (line 93): Tool-call-level approval detection -- catches the approval, shows panel, user approves
2. Step 3 (line 104): Phase-level approval detection -- skipped (tool call already prompted)
3. **Step 4 (line 119): Phase change display** -- sees `EXECUTION_WAITING_FOR_APPROVAL != lastPhase`, prints "Approval required"

The approval was already handled in Step 2, but Step 4 does not know this. It blindly fires `displayAgentPhaseChange()` for every phase transition. Then on the *next* stream update, the backend has processed the approval and the phase goes back to `EXECUTION_IN_PROGRESS`, so Step 4 fires again with "Execution started."

### Fix

In `run_stream.go`, after handling an approval in Step 2 or Step 3, update `lastPhase` to the current execution phase. This prevents Step 4 from displaying the now-redundant `EXECUTION_WAITING_FOR_APPROVAL` phase change. Additionally, in `displayAgentPhaseChange()` in `[run_display.go](client-apps/cli/cmd/stigmer/root/run_display.go)`, add awareness that a transition from `WAITING_FOR_APPROVAL` back to `IN_PROGRESS` is a "resume" -- not a fresh start.

**Concrete changes:**

- `**[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)**`: After both approval handling blocks (Step 2 lines 93-100, Step 3 lines 104-116), set `lastPhase = execution.Status.Phase` to suppress the redundant phase change display.
- `**[run_display.go](client-apps/cli/cmd/stigmer/root/run_display.go)**`: Change `displayAgentPhaseChange` to accept a `previousPhase` parameter. When transitioning from `WAITING_FOR_APPROVAL` to `IN_PROGRESS`, display "Resumed after approval" instead of "Execution started". This handles the edge case where the phase update arrives in a *later* stream tick than the one where approval was handled.

### Expected Result After Fix

```
🖥  Execute: cd /workspace && python ...

╭─ APPROVAL REQUIRED ─────────────────────────╮
│  Tool:  execute                              │
│  Message: Execute command: ...               │
│  Waiting for: just now                       │
╰──────────────────────────────────────────────╯

  ▸ Approve — Execute the tool
    Skip — Continue without executing
    Reject — Fail the execution

✓ Tool execution approved

⠹ Resuming after approval...
```

No redundant "Approval required" line. No redundant "Execution started." The spinner message "Resuming after approval..." (already set on line 99/115) is the only indication -- which is exactly what the user needs.

---

## Problem 2: "messages: at least one message is required" Error (Backend investigation + CLI hardening)

### What Happened

The error `Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'messages: at least one message is required'}}` is a raw Anthropic API response. It means the LLM was called with zero messages -- a clear bug in the resume path.

### Root Cause Hypothesis

In `[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` (lines 1228-1247), when resuming after approval:

```python
if is_resume_from_approval and resume_decision is not None:
    graph_input = Command(resume=resume_decision)  # Resume from LangGraph checkpoint
```

LangGraph's `Command(resume=...)` resumes from a checkpoint. The checkpoint is identified by `thread_id` (line 1264: `config=config` which contains `thread_id`). If the checkpoint store (likely PostgreSQL) does not have the correct state saved, or if the `thread_id` doesn't match, LangGraph may start a fresh invocation with no messages -- which Anthropic rejects.

This is a **backend bug** that needs investigation. Possible causes:

- Checkpoint not saved before `interrupt()` returned
- `thread_id` mismatch between initial run and resume
- Checkpoint store connectivity issue causing a miss
- LangGraph version incompatibility with `Command(resume=...)` and `astream_events`

### Recommended Approach

This should be split into two sub-tasks:

**2a. CLI hardening -- never show raw API errors to users**

In `[run_display_stream.go](client-apps/cli/cmd/stigmer/root/run_display_stream.go)`, when rendering system messages that contain raw API error responses (identifiable by patterns like `Error code: NNN - {` or `invalid_request_error`), sanitize them to a user-friendly message. The `writeCompleteMessage` method for `MESSAGE_SYSTEM` currently renders the content verbatim. Add an error-sanitization layer.

Additionally, the error message in the execution summary should show a human-friendly version, not the raw exception string.

**2b. Backend investigation -- why checkpoint resume sends empty messages** (requires deeper investigation)

This requires looking at:

1. Agent runner logs for the specific execution (`aex-01khdwth54qk350ftdjckbyhzh`) to see what the checkpoint state looked like at resume time
2. Whether the LangGraph checkpoint store has the thread's state
3. Whether `astream_events` with `Command(resume=...)` properly loads from checkpoint before calling the LLM

**I want to flag this as a "pause and collaborate" item.** The fix might be straightforward (e.g., checkpoint store config issue) or it might reveal a deeper architectural issue with how LangGraph handles `interrupt()`/`Command(resume=...)` in the Graphton agent. I do not want to guess at the fix -- I would rather investigate the agent runner logs together with you and make an informed decision.

---

## Files Affected


| File                                                     | Change Type                                |
| -------------------------------------------------------- | ------------------------------------------ |
| `client-apps/cli/cmd/stigmer/root/run_stream.go`         | Update `lastPhase` after approval handling |
| `client-apps/cli/cmd/stigmer/root/run_display.go`        | Add resume-aware phase display             |
| `client-apps/cli/cmd/stigmer/root/run_display_stream.go` | Sanitize raw API errors in system messages |
| `client-apps/cli/cmd/stigmer/root/run_display_test.go`   | Tests for new phase display behavior       |
| `client-apps/cli/cmd/stigmer/root/run_stream_test.go`    | Tests for lastPhase update after approval  |


Backend investigation (Problem 2b) may touch `execute_graphton.py` and `status_builder.py` but only after root-cause is confirmed.

---

## Design Decision: Should "Approval Required" exist as a phase display at all?

A question worth considering: the approval panel already has the title "APPROVAL REQUIRED" in a styled box. The interactive prompt already makes it clear that the user needs to act. So the phase change message "Approval required" is redundant even in the case where it *would* display at the right time (before the prompt). The prompt IS the "approval required" signal.

My recommendation: suppress the `EXECUTION_WAITING_FOR_APPROVAL` phase change message entirely from `displayAgentPhaseChange()`. The approval panel and interactive prompt are the correct UX for this state -- an additional status line adds noise without information. I will implement this approach unless you feel the phase line serves a purpose I am not seeing.