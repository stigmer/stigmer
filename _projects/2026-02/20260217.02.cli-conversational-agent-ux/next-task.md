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
**Current Task**: Phase 2 — Conversational TUI
**Status**: Phase 1 Complete — Ready for Phase 2

## Session Progress (2026-02-19)

### Accomplished

- **T01 research and planning complete** — T01_0_plan.md (initial), T01_1_review.md (your feedback), T01_2_revised_plan.md (final design) all in `tasks/`
- **Phase 1 implemented and committed** — `refactor(cli): make session the sole user-facing concept in agent execution flow` (`726333b1`)

### Phase 1 Changes (committed)

| File | Change |
|------|--------|
| `run_create.go` | `CreateAgentExecutionInput` struct replaces 8-param signature; `SessionID` field ready for Phase 2 follow-ups |
| `run_handlers.go` | "Starting session..." replaces "Creating agent execution..."; execution ID never shown; defensive `log.Warn()` if session_id missing |
| `draft_skill_handler.go` | Same session-centric messaging; hint updated to `stigmer run <session-id>` |
| `run_stream.go` | "Streaming session..." replaces "Streaming agent execution logs" |
| `run_session.go` | "Re-attaching to session..." replaces "Re-attaching to running execution..." |

### Key Decisions Made

1. **Session storage is server-side only** — backend already has full Session API resource; no local storage needed
2. **Auto-create sessions for Phase 1** — backend auto-creates sessions when `agent_id` is provided; explicit CLI session creation deferred to Phase 2 (where it's actually needed for follow-ups)
3. **`CreateAgentExecutionInput` struct** — extensible for Phase 2 without further refactoring; `SessionID` field controls whether a new session or follow-up is created

## Next Steps — Phase 2: Conversational TUI

Phase 2 goal: Add input composer (textarea at bottom of TUI) and conversational flow so users can send follow-up messages after the agent completes.

### Phase 2 approach (from T01_2_revised_plan.md)

**Three TUI states to implement:**
1. `Streaming` — agent outputting; input area dimmed with "Agent is working..."
2. `WaitingForInput` — agent completed or asked question; input active; cursor blinks
3. `UserTyping` — user composing; Enter sends; Esc exits

**What "send follow-up" means (no new backend changes needed):**
- User sends a message after agent completes → CLI calls `createAgentExecution(CreateAgentExecutionInput{SessionID: ses.ID, Message: followUp})`
- Backend creates a new execution within the same session
- TUI subscribes to the new execution stream and continues rendering in the same viewport

**Open questions to resolve before Phase 2 starts:**
1. **Bidirectional gRPC vs separate "respond" RPC** — for agent-initiated questions (Phase 3), do we extend the stream or add a unary `RespondToQuestion`? Phase 2 doesn't need this (only follow-ups, not mid-execution questions), but the answer shapes Phase 3.
2. **Follow-up execution context** — when the user sends a follow-up, how much history carries over? Full conversation thread? Summary? This is controlled by `SessionSpec.thread_id` on the backend — Phase 2 just needs to pass `session_id` and the backend handles context continuity.

### Phase 2 work packages (estimated order)

1. Add `WaitingForInput` / `UserTyping` states to `executiontui.Model`
2. Add `textarea` component (Bubble Tea `bubbles/textarea`) to TUI bottom zone
3. Wire up: when `DoneEvent` arrives, transition to `WaitingForInput`
4. On Enter in `UserTyping`: create new execution in same session via `createAgentExecution(SessionID: ...)`
5. Subscribe to new execution stream; continue rendering in same viewport
6. Add "Continue the conversation or press Esc to exit" footer hint

## Quick Commands

After loading context:
- "Start Phase 2" — Begin conversational TUI implementation
- "Review Phase 2 plan" — See full T01_2_revised_plan.md
- "Show project status" — Overview of progress

## Open Questions

1. **Bidirectional gRPC vs separate RPC** for Phase 3 "ask user" flow — defer until Phase 2 is done, but good to decide before starting Phase 3
2. **Session subject line** — When should the CLI set `session.spec.subject`? Could auto-derive from the first message (first 50 chars). Nice-to-have for `stigmer list sessions` display.

---

*This file provides direct paths to all project resources for quick context loading.*
