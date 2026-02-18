# Next Task: 20260217.02.cli-conversational-agent-ux

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260217.02.cli-conversational-agent-ux

**Description**: Research and design a conversational UX for agent executions in the Stigmer CLI. Currently, commands like 'stigmer draft skill' trigger agent executions shown as single-shot operations, but agents are conversational by nature — they may ask questions, need user input, or trigger further executions. This project explores how other CLI tools handle interactive agent conversations and designs Stigmer's approach.
**Goal**: Design and plan a conversational agent execution UX for the Stigmer CLI that supports bidirectional interaction between users and agents during commands like 'stigmer run' and 'stigmer draft', informed by research of how similar tools handle this.
**Tech Stack**: Go (Stigmer CLI), TUI/terminal UX patterns, gRPC streaming
**Components**: CLI (stigmer run, stigmer draft commands), agent-runner service, execution model, session management

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260217.02.cli-conversational-agent-ux/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-17 17:39
**Current Task**: Phase 3 — "Ask User" Protocol
**Status**: Phase 2 Complete — Ready for Phase 3

## Session Progress (2026-02-19)

### Accomplished

- **Phase 2 designed and implemented** — `feat(cli): add conversational follow-up to agent execution TUI` (`985a509f`)
- **Changelog written** — `_changelog/2026-02/2026-02-19-021633-phase2-conversational-tui.md`

### Phase 2 Changes (committed: `985a509f`)

| File | Change |
|------|--------|
| `executiontui/followup.go` (new) | `FollowUpFn`/`FollowUpResult` types; `handleFollowUpStarted` (channel swap + state reset); `handleFollowUpError` (show error, reactivate input) |
| `executiontui/input.go` (new) | Two-zone layout rendering; `handleInputKey` (Esc exits, Enter submits); `executeFollowUpCmd` (async `FollowUpFn` invocation) |
| `executiontui/model.go` | `FollowUpFn` on Config; `textarea`, `inputActive`, `activeEvents/Approvals/CancelFn`, `latestExecutionID` fields; `LatestExecutionID()` accessor |
| `executiontui/update.go` | `inputActive` gate in `handleKeyPress` (priority 2, above all but Ctrl+C); `handleWindowSize` accounts for `inputAreaHeight`; activity tick stops when `inputActive` |
| `executiontui/handle_events.go` | `DoneEvent` activates input (all terminal phases) when `FollowUpFn` set; `handleStreamClosed` skips error when `inputActive`; dispatches new message types |
| `executiontui/view.go` | Two-zone `View()`; `inputActive` footer state |
| `executiontui/approval.go` | Uses `m.activeApprovals` (not `m.cfg.ApprovalResponses`) |
| `executiontui/help.go` | "Conversation" help section added |
| `run_stream.go` | `streamAgentExecution` gains `orgID` param; `buildFollowUpFn` closure; uses `LatestExecutionID()` for final fetch |
| `run_handlers.go`, `run_session.go`, `draft_skill_handler.go` | Thread `orgID` through to `streamAgentExecution` |

### Key Decisions Made This Session

1. **`FollowUpFn` callback pattern** (not state enum) — follows `CancelFn` pattern; TUI stays decoupled from gRPC
2. **`inputActive` flag** (not Streaming/WaitingForInput/UserTyping states) — simpler, more Bubble Tea-idiomatic
3. **All terminal phases activate input** — failed/cancelled executions activate input too; user can send corrective follow-ups
4. **Artifact download stays single-execution for MVP** — `draft_skill_handler` downloads from first execution; session-level artifact tracking deferred
5. **`FollowUpFn` only set when `sessionID != ""`** — conversational mode is gated on having a valid session; detach mode is already safe (never calls `streamAgentExecution`)

## Next Steps — Phase 3: "Ask User" Protocol

Phase 3 goal: Enable agents to ask the user questions mid-execution. The agent emits an `ASK_USER` event; the TUI activates the input composer; the user's response is sent back to the backend; the agent continues.

### What needs to happen

1. **Backend**: New event type in the execution streaming protocol — `ASK_USER` with question payload
2. **gRPC**: Decide: bidirectional stream extension OR separate unary `RespondToQuestion` RPC
3. **`run_stream_events.go`**: Detect `ASK_USER` event from proto; emit a new `AskUserEvent` to TUI
4. **`executiontui/events.go`**: Add `AskUserEvent` type
5. **`handle_events.go`**: When `AskUserEvent` arrives, activate input without setting `done`
6. **`input.go`**: On Enter while agent is paused mid-execution, call a `RespondFn` (similar pattern to `FollowUpFn`) instead of creating a new execution
7. **Non-interactive mode**: If no response within timeout (or `--non-interactive` flag), signal agent to proceed with best judgment

### Open Design Questions for Phase 3

1. **Bidirectional gRPC vs separate `RespondToQuestion` RPC** — bidirectional is cleaner but more complex; separate RPC is simpler and follows current approval pattern
2. **Input routing when both approval and ask-user are possible** — need to ensure the two modes don't conflict
3. **Non-interactive timeout** — what's the right default? Should the CLI send an explicit "user unavailable" or just let the backend time out?

## Quick Commands

After loading context:
- "Start Phase 3" — Begin "Ask User" protocol design
- "Review Phase 3 plan" — See T01_2_revised_plan.md Phase 3 section
- "Show project status" — Overview of all phases

## Remaining Open Questions

1. **Bidirectional gRPC vs separate RPC** for Phase 3 "ask user" flow — this is the first thing to decide before starting Phase 3
2. **Session subject line** — When should the CLI set `session.spec.subject`? Auto-derive from first message (first 50 chars) is a nice-to-have for `stigmer list sessions` display

---

*This file provides direct paths to all project resources for quick context loading.*
