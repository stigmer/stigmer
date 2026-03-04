# Next Task: 20260305.01.bubbletea-inline-renderer

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260305.01.bubbletea-inline-renderer

**Description**: Rewrite the Stigmer CLI inline renderer to use Bubbletea inline mode (no alt screen), replacing all manual ANSI cursor math (lineCountingWriter, termctl.EraseLines, raw escape sequences) with Bubbletea framework-managed rendering. Preserves every existing UX decision (compact tool rendering, approval panels, streaming collapse, thinking spinner, follow-up prompts).
**Goal**: Eliminate fragile manual cursor tracking in favor of Bubbletea built-in row management so all in-place terminal updates (subject replacement, approval collapse, tool streaming, follow-up prompt) work correctly regardless of terminal width, wrapping, or interleaved output.
**Tech Stack**: Go / Bubbletea (charmbracelet) -- already a dependency
**Components**: cmd/stigmer/root/run_stream_inline*.go, cmd/stigmer/root/run_stream_inline_approval.go, cmd/stigmer/root/run_stream_inline_streaming.go, cmd/stigmer/root/run_stream_inline_followup.go, pkg/approval/inline_prompter.go, pkg/spinner/, pkg/termctl/

## Current State
- **Status**: in-progress
- **Last Session**: March 5, 2026 -- Phase 3 (Header Simplification) completed
- **Active Task**: T01 Architecture Design and Migration Plan -- Phases 1-3 done, Phase 4 next

## Session Progress (2026-03-05, Session 3)
- Completed Phase 3: Header Simplification
- Discovered architectural constraint: Bubbletea's `View()` renders at the bottom; `Println()` commits above. Putting the header in `View()` would invert the display order. Header must stay as committed content.
- Deleted `run_stream_inline_header_update.go` entirely (176 lines): `lineCountingWriter`, `subjectUpdater`, `setupSubjectUpdater`, `pollSessionSubject`, `renderSubjectPanelRow`, `subjectLineOffset`, all ANSI cursor constants
- Deleted `run_stream_inline_header_update_test.go` entirely (175 lines): 11 tests for deleted code
- Simplified `run_agent_exec.go`: removed Subject placeholder, writer wrapping, background polling goroutine, unused `"context"` import
- New sessions render header without Subject field (no placeholder dash); session resume shows Subject when resolved
- 3 files changed, 1 insertion, 362 deletions; zero visual regression

## Previous Session Progress (2026-03-05, Session 2)
- Completed Phase 2: Spinner Migration to Bubbletea View()
- Exported `Frames`, `FrameInterval`, `FormatElapsed` from `pkg/spinner` for shared use
- Bubbletea model gained spinner state, three message types, `Update()` handlers with tea.Tick chain, and `View()` rendering
- `startThinkingSpinner`/`stopThinkingSpinner` now route through `program.Send()` instead of `spinner.Start/Stop`
- 8 new model tests; all 18 spinner/bubbletea tests pass; zero visual regression

## Previous Session Progress (2026-03-05, Session 1)
- Completed Phase 1: Bubbletea Program Shell -- Foundation
- Discovered 3 API constraints that revised T01 plan; adopted conservative integration strategy
- New files: `run_stream_inline_bubbletea.go`, `run_stream_inline_bubbletea_test.go`
- Modified: `run_stream.go`, `run_stream_inline.go`

## Next Steps
1. **Phase 4: Approval Flow Migration** -- Move the blocking approval flow into Bubbletea's event-driven Update cycle. Replace all 6 `termctl.EraseLines` call sites with `View()` state transitions. This is the most complex phase -- needs a dedicated planning session.
2. **Phase 5: Tool Streaming Migration** -- Move pre-approval tool content streaming into `View()`.
3. **Phase 6: Follow-up Prompt Migration** -- Move follow-up prompt into `View()`.

## Plan Divergence (READ THIS)

The original T01 plan (`tasks/T01_0_plan.md`) assumed a "single writer / all output through tea.Println()" approach. Multiple phases revealed API constraints. A conservative integration strategy was adopted. The T01 plan is marked REVISED -- phase descriptions are directional goals, not literal specs. Each phase should be re-evaluated against the actual foundation before implementation.

Key documents:
- `design-decisions/001-conservative-bubbletea-integration.md` -- full rationale and comparison table
- `design-decisions/002-header-stays-committed.md` -- why the header cannot go into View()
- `wrong-assumptions/001-single-writer-all-through-println.md` -- what we got wrong and why

## Context for Resume
- Bubbletea Program is configured with `tea.WithOutput(statusW)` + `tea.WithInput(nil)` -- owns stderr, avoids stdin/stdout conflicts
- AI content continues directly to stdout via `dataW` (unchanged)
- `statusf()` routes through `program.Println()` when program is non-nil and not in approval flow
- `inApprovalFlow` sentinel ensures approval-adjacent writes bypass Bubbletea's async render queue
- **Model's `View()` now renders the thinking spinner** when active (Phase 2) -- returns "" when inactive
- Spinner uses idiomatic `tea.Tick` Cmd chain: `spinnerStartMsg` -> tick chain at 80ms -> `spinnerStopMsg` terminates chain
- The event loop still owns the 2s idle timer and start/stop decisions; it communicates to Bubbletea via `program.Send()`
- **Session header renders directly to stderr before Bubbletea starts** (Phase 3) -- `lineCountingWriter` and `subjectUpdater` deleted; no writer wrapping; raw `os.Stdout/os.Stderr` passed to streaming pipeline
- Key files to read when resuming: `run_stream.go` (lifecycle), `run_stream_inline.go` (routing), `run_stream_inline_bubbletea.go` (model + spinner), `run_stream_inline_spinner.go` (timer + routing)

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
6. [ ] Continue with Phase 4: Approval Flow Migration

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260305.01.bubbletea-inline-renderer/next-task.md`

## Quick Commands

After loading context:
- "Continue with Phase 4" - Resume with approval flow migration
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
