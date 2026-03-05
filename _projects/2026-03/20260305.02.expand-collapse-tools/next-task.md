# Next Task: 20260305.02.expand-collapse-tools

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260305.02.expand-collapse-tools

**Description**: Build an event history + clear+re-commit mechanism for the Stigmer CLI inline renderer. Enables: (1) session header subject update without ANSI cursor math, (2) expand/collapse toggle for tool executions similar to Claude Code's Ctrl+O, (3) read-file group expansion, and (4) a general-purpose re-render capability for future triggers (terminal resize, theme toggle).
**Goal**: Retain structured event data in the Bubbletea model so the entire session can be re-rendered on demand. First use case: subject update. Primary use case: Ctrl+O expand/collapse toggle for tool calls and read groups.
**Tech Stack**: Go / Bubbletea (charmbracelet)
**Components**: inline renderer (run_stream_inline*.go), Bubbletea model (run_stream_inline_bubbletea.go), toolrender package, model state retention, key binding handling

## Current Status

**Created**: 2026-03-05 05:00
**Current Task**: T02 — Phase 1 (Event History Retention + Subject Update)
**Status**: Complete — ready for commit
**Last Session**: 2026-03-05

## Session Progress (2026-03-05)

### Completed
- **T01**: Plan approved (T01_0_plan.md)
- **T02 Phase 1**: Fully implemented — all 7 steps complete

### Key Decisions Made
1. **History lives on `inlineRenderer`**, not the Bubbletea model — synchronous appends, no races
2. **AI content replayed to stderr** during re-commit — preserves stdout pipe compatibility
3. **Session header stays as pre-Bubbletea direct write** — renderer stores it as `history[0]` for re-commit only
4. **Pre-rendered text for mode-invariant items** (AI, system, lifecycle messages); **structured data for mode-variable items** (tool calls, read groups, approvals, header)
5. **`sessionSubject` dead parameter replaced** with `sessionHeaderInfo` struct threaded through the entire call chain

### Files Created (4)
- `run_stream_inline_history.go` — `committedKind`, `committedItem`, `renderCommittedItem`, `reCommitHistory`, `triggerReCommit`
- `run_stream_inline_header_update.go` — `pollSessionSubject` goroutine
- `run_stream_inline_history_test.go` — tests for all 12 `committedKind` variants, re-commit Cmd generation, subject mutation
- `run_stream_inline_header_update_test.go` — context cancellation, resolved subject sentinel tests

### Files Modified (11)
- `run_stream_inline_types.go` — `history []committedItem` on renderer; `headerInfo`, `subjectUpdate` on config
- `run_stream_inline_render.go` — history append in every render method; `recordAIMessage` helper
- `run_stream_inline_approval_display.go` — `recordApproval` helper; `printCollapsedResult` delegates
- `run_stream_inline_approval.go` — `recordApproval` calls in both Bubbletea approval paths
- `run_stream_inline_messages.go` — `reCommitMsg` type
- `run_stream_inline_bubbletea.go` — `handleReCommit` method, wired in `Update()` switch
- `run_stream.go` — `sessionHeaderInfo` param, subject poll goroutine start
- `run_stream_inline.go` — `history[0]` init, `subjectUpdate` select case
- `run_agent_exec.go` — pass `headerInfo` to `streamAgentExecution`
- `run_session.go` — pass `headerInfo` to `streamAgentExecution` / `resumeSession`
- `BUILD.bazel` — added new source + test files

### Discoveries During Implementation
1. **stdout/stderr tension with ClearScreen** — `tea.ClearScreen` erases entire terminal including stdout AI content; resolved by replaying everything to stderr during re-commit
2. **`resumeSession` bypasses Bubbletea** — subject update irrelevant there (subject already resolved); Phase 4 will need Bubbletea for Ctrl+O
3. **`sessionSubject` was dead code** — replaced with structured `sessionHeaderInfo`
4. **BUILD.bazel had phantom file references** — pre-allocated for this work; files now created

## Next Steps

1. **T02 Phase 2**: Expand/collapse rendering for tool calls (main feature)
2. **T02 Phase 3**: Ctrl+O keybinding wiring
3. **T02 Phase 4**: Follow-up history recording, resumed session Bubbletea support
4. **T02 Phase 5**: Performance profiling for long sessions

## Context for Resume

- Plan file: `.cursor/plans/phase_1_event_history_0eda7a7b.plan.md`
- T01 plan: `_projects/2026-03/20260305.02.expand-collapse-tools/tasks/T01_0_plan.md`
- Two pre-existing test failures (`TestHandleApproval_DoesNotSuppressOnReject`, `TestInlineRenderer_ToolCompleted_ShowsBadge`) are NOT from this work — they fail on the base commit
- `go vet` passes clean; all new tests pass

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.02.expand-collapse-tools/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Quick Commands

After loading context:
- "Continue with Phase 2" - Resume with tool call expand/collapse rendering
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
