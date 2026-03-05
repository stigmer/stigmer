# Next Task: 20260305.01.bubbletea-inline-renderer

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260305.01.bubbletea-inline-renderer

**Description**: Rewrite the Stigmer CLI inline renderer to use Bubbletea inline mode (no alt screen), replacing all manual ANSI cursor math (lineCountingWriter, termctl.EraseLines, raw escape sequences) with Bubbletea framework-managed rendering. Preserves every existing UX decision (compact tool rendering, approval panels, streaming collapse, thinking spinner, follow-up prompts).
**Goal**: Eliminate fragile manual cursor tracking in favor of Bubbletea built-in row management so all in-place terminal updates (subject replacement, approval collapse, tool streaming, follow-up prompt) work correctly regardless of terminal width, wrapping, or interleaved output.
**Tech Stack**: Go / Bubbletea (charmbracelet) -- already a dependency
**Components**: cmd/stigmer/root/run_stream_inline*.go, cmd/stigmer/root/run_stream_inline_approval.go, cmd/stigmer/root/run_stream_inline_streaming.go, cmd/stigmer/root/run_stream_inline_followup.go, pkg/approval/inline_prompter.go, pkg/spinner/, pkg/termctl/

## Current State
- **Status**: complete
- **Last Session**: March 5, 2026 -- Phase 7 (Cleanup) completed
- **Active Task**: T01 Architecture Design and Migration Plan -- All 7 Phases complete

## Session Progress (2026-03-05, Session 7)
- Completed Phase 7: Cleanup -- Dead Code Removal, File Splitting, Comment Hygiene
- **Dead code removed**: `termctl.SaveCursor`/`RestoreCursorAndClear` (zero callers), `lastRenderedRunningID`/`runningLineRendered` tracking (always-false due to suppressed ToolRunningEvent), `mockAutoApprovePrompter` (unused test type)
- **Stale comments fixed**: termctl.go (line-counting middleware references), approval.go (EraseLines-only collapse reference), spinner.go (former goroutine migration commentary)
- **File splitting** (4 new files created):
  - `run_stream_inline.go` 658→243 lines (extracted `_types.go` 137 lines, `_render.go` 283 lines)
  - `run_stream_inline_approval.go` 464→278 lines (extracted `_approval_display.go` 187 lines)
  - `run_stream_inline_bubbletea.go` 358→275 lines (extracted `_messages.go` 82 lines)
- **Function refactoring**: `renderToolStreamDeltaDirect` (90 lines) split into 3 focused helpers: `renderStreamDeltaUncapped`, `renderStreamOverflowUpdate`, `renderStreamDeltaCapped` (~14-37 lines each), parent reduced to ~14-line router
- **BUILD.bazel updated**: 4 new source files, 1 new test file, bubbletea dependency added
- Net: 11 files modified, 4 new files, -871 deletions / +98 additions in tracked files
- All tests pass (same 2 pre-existing failures: `TestHandleApproval_DoesNotSuppressOnReject`, `TestInlineRenderer_ToolCompleted_ShowsBadge`)

## Previous Session Progress (2026-03-05, Session 6)
- Completed Phase 6: Follow-up Prompt Migration to Bubbletea View()

## Previous Session Progress (2026-03-05, Session 5)
- Completed Phase 5: Tool Streaming Migration to Bubbletea View()

## Previous Session Progress (2026-03-05, Session 4)
- Completed Phase 4: Approval Flow Migration to Bubbletea View()

## Previous Session Progress (2026-03-05, Session 3)
- Completed Phase 3: Header Simplification

## Previous Session Progress (2026-03-05, Session 2)
- Completed Phase 2: Spinner Migration to Bubbletea View()

## Previous Session Progress (2026-03-05, Session 1)
- Completed Phase 1: Bubbletea Program Shell -- Foundation

## Next Steps
1. **Project complete** -- All 7 phases of the Bubbletea inline renderer migration are done.
2. **Project 20260305.02 (expand-collapse-tools)** is now unblocked.
3. **Pre-existing test failures** should be addressed in a separate session (not part of this project scope).

## Plan Divergence (READ THIS)

The original T01 plan (`tasks/T01_0_plan.md`) assumed a "single writer / all output through tea.Println()" approach. Multiple phases revealed API constraints. A conservative integration strategy was adopted. The T01 plan is marked REVISED -- phase descriptions are directional goals, not literal specs. Each phase should be re-evaluated against the actual foundation before implementation.

Key documents:
- `design-decisions/001-conservative-bubbletea-integration.md` -- full rationale and comparison table
- `design-decisions/002-header-stays-committed.md` -- why the header cannot go into View()
- `wrong-assumptions/001-single-writer-all-through-println.md` -- what we got wrong and why

## Context for Resume
- Bubbletea Program is configured with `tea.WithOutput(statusW)` + `tea.WithInput(nil)` -- owns stderr, avoids stdin/stdout conflicts
- AI content continues directly to stdout via `dataW` (unchanged)
- `statusf()` routes through `program.Println()` when program is non-nil -- no more `inApprovalFlow` gate (removed in Phase 4)
- **Model's `View()` now renders the approval panel** when `approvalActive` (Phase 4) -- expanded content + question + menu
- **Model's `View()` now renders streaming content** when `streamingActive` (Phase 5) -- header + width-clamped/line-capped content
- **Model's `View()` now renders the follow-up prompt** when `followUpActive` (Phase 6) -- separator + hint + prompt marker
- **View() priority**: `approval > streaming > followUp > spinner > empty`
- **Model's `View()` renders the thinking spinner** when active (Phase 2) -- returns "" when inactive
- **All `termctl.EraseLines` calls are unreachable in the Bubbletea path** after Phase 6; direct-write fallback EraseLines preserved for program == nil
- **Session header renders directly to stderr before Bubbletea starts** (Phase 3)
- **Phase 7 file structure** (post-cleanup):
  - `run_stream_inline.go` (243 lines) -- event loop + handleEvent dispatch
  - `run_stream_inline_types.go` (137 lines) -- all struct/type definitions
  - `run_stream_inline_render.go` (283 lines) -- all rendering methods + helpers
  - `run_stream_inline_messages.go` (82 lines) -- Bubbletea message types
  - `run_stream_inline_bubbletea.go` (275 lines) -- model + Init/Update/View + handlers
  - `run_stream_inline_approval.go` (278 lines) -- approval orchestration flow
  - `run_stream_inline_approval_display.go` (187 lines) -- approval display helpers
  - `run_stream_inline_streaming.go` (340 lines) -- tool content streaming
  - `run_stream_inline_spinner.go` (71 lines) -- spinner event-loop helpers
  - `run_stream_inline_followup.go` (163 lines) -- follow-up prompt flow
  - `run_stream_inline_header.go` (105 lines) -- session header rendering

## Blockers (if any)
- None

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.01.bubbletea-inline-renderer/dont-dos/`
6. [ ] Project is complete -- proceed to 20260305.02.expand-collapse-tools

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260305.01.bubbletea-inline-renderer/next-task.md`

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
