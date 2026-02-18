# T01 Plan Review — Developer Feedback

**Date**: 2026-02-17
**Reviewer**: Suresh

## Feedback

### 1. "Execution" is an internal concept — don't expose it

The wireframe in the plan shows "Execution started (exec-abc123)" and "Execution started (exec-def456)" to the user. This is too noisy and exposes internal backend mechanics. The "execution" concept is an implementation detail — users should not see execution IDs or lifecycle phase transitions (started/completed/failed).

**What the user sees should be session-level, not execution-level.**

### 2. Sessions, not executions, are the user-facing concept

The user's mental model should be a **session** (or conversation). When a user runs `stigmer draft skill`, they start a session. Within that session:
- The agent may do multiple things (internally, multiple executions)
- The agent may ask questions
- The user may give follow-up instructions
- All of this is one continuous experience

The user cares about getting back to a **session** to check progress — they want a session ID (or name), not an execution ID.

### 3. Noise reduction is critical

The plan's wireframe is too verbose with lifecycle events. Instead of:
```
▶ Execution started (exec-abc123)
...
✅ Execution completed
▶ Execution started (exec-def456)
```

Something more like:
```
🤖 Agent is working on your request...
[streaming output]
❓ Agent has a question for you
> [user input]
🤖 Agent is continuing...
[streaming output]
✅ Done!
```

The internal execution boundaries should be invisible to the user.

### 4. Deep research needed before design decisions

Before making decisions on the plan's "Key Design Decisions" section, we need deep external research on how similar tools handle:
- Session vs execution abstraction
- Conversational flow patterns in CLIs
- Terminal UI patterns for chat-like agent interactions
- Session resumability
- Noise reduction / progressive disclosure

**Action**: Deep research prompt created at `research.conversational-cli-agent-ux/01.prompt.md`

## Requested Changes

1. **Remove all "execution" terminology from user-facing wireframes** — replace with session-level abstractions
2. **Defer design decisions until deep research is complete** — the plan should be research-first
3. **Add research as a prerequisite** before Phase 2 (Design)
4. **Revise the proposed UX model** to hide execution lifecycle events entirely

## Status

**Decision**: Plan needs revision after deep research is completed. Pausing design work until research report is available.
