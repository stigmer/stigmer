# Next Task: 20260225.01.cli-todo-blocks

## Current State
- **Status**: in-progress
- **Last Session**: 2026-02-25 — Completed Task 4 (handle TodoUpdateEvent in TUI)
- **Active Task**: Task 5 — Wire todo handling in snapshot bridge for session resume

## Session Progress (2026-02-25, Session 3)
- Completed Task 4: Added `todoBlockIdx int` field to Model, `case TodoUpdateEvent` to event dispatcher, follow-up reset in `handleFollowUpStarted`. First event appends block and tracks index; subsequent events update in-place preserving user's expand/collapse state. 3 tests. Uncommitted — ready for commit.
- Design decisions: plain `int` sentinel (not map) since there's exactly one todo block per execution; mirrors `updateToolBadge` pattern for bounds-check-and-update vs. append-and-track

## Session Progress (2026-02-25, Session 2)
- Completed Task 2: Added `blockTodo` type, `newTodoBlock()` constructor, rendering functions (`todoStatusIcon`, `sortTodosForDisplay`, `renderTodoPreview`, `renderTodoExpanded`), and tests. Committed as `80f81724`.
- Completed Task 3: Added todo change detection in stream bridge — `mapTodoStatus`, `convertProtoTodos`, fingerprint-based diffing (`todoFingerprint` struct, `emitTodoEvents`, `buildTodoFingerprints`, `todoFingerprintsChanged`), wired as Step 1d in `streamToEvents`. 9 tests. Committed as `3590bef4`.
- Design decisions: fingerprint-based change detection using comparable struct (not string concatenation), guard condition for zero-cost skip on executions without todos

## Session Progress (2026-02-25, Session 1)
- Completed Task 1: Added `TodoItem` domain type and `TodoUpdateEvent` to `events.go`
- Verified the `handle_events.go` typo from planning was a transcription artifact (not a real bug)
- Build compiles cleanly, committed as `456b4fb9`
- Decision: full-snapshot events (not per-item deltas), timestamps omitted from domain type

## Next Steps
1. **Task 5**: Wire todo handling in `run_stream_snapshot.go` for session resume — emit `TodoUpdateEvent` from stored execution snapshot so resumed sessions show the todo block. Use `convertProtoTodos` (already exists from Task 3) on `status.GetTodos()`.
2. **Task 6**: Full build verification

## Context for Resume
- Branch: `fix/cli-agent-execution-ux`
- The new types live at the end of `events.go` (lines 173-197), between `StreamErrorEvent` and `ApprovalResponse`
- Proto source: `AgentExecutionStatus.todos` is `map<string, TodoItem>` (field 9 in `api.proto`)
- Backend populates via `write_todos` tool in `status_builder.py` (part of `PLANNING_TOOLS` set — returns early without UI display)
- Key design: full-snapshot replacement pattern, domain type separation, ordering is renderer's concern
- Stream bridge: `emitTodoEvents` in `run_stream_events.go` handles diff detection. Conversion functions (`mapTodoStatus`, `convertProtoTodos`) in `run_stream_convert.go`.
- Block rendering: `newTodoBlock` in `blocks.go`, `renderTodoPreview`/`renderTodoExpanded` in `render_blocks.go`. Block starts expanded.
- Event handling: `case TodoUpdateEvent` in `handle_events.go`. Tracks block position via `todoBlockIdx int` on Model (sentinel `-1`). Reset in `handleFollowUpStarted`.

## Blockers
- None

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-02/20260225.01.cli-todo-blocks/next-task.md`

---

## Project Overview

**Name**: 20260225.01.cli-todo-blocks  
**Description**: Add todo/planning item rendering to the CLI TUI during agent execution. The proto definitions and backend already populate todos — this project wires them into the CLI output as expandable, self-updating blocks.  
**Goal**: Show agent todo/planning items in the CLI TUI output so users can see task progress during execution  
**Tech Stack**: Go/Bubbletea TUI  
**Components**: client-apps/cli/pkg/executiontui, client-apps/cli/cmd/stigmer/root/run_stream_events.go

**Created**: 2026-02-25  
**Type**: Quick Project (1-2 sessions)

---

## Essential Files

### Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.01.cli-todo-blocks/tasks.md
```

### Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.01.cli-todo-blocks/README.md
```

### Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260225.01.cli-todo-blocks/notes.md
```

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*
