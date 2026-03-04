# Next Task: 20260305.01.bubbletea-inline-renderer

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260305.01.bubbletea-inline-renderer

**Description**: Rewrite the Stigmer CLI inline renderer to use Bubbletea inline mode (no alt screen), replacing all manual ANSI cursor math (lineCountingWriter, termctl.EraseLines, raw escape sequences) with Bubbletea framework-managed rendering. Preserves every existing UX decision (compact tool rendering, approval panels, streaming collapse, thinking spinner, follow-up prompts).
**Goal**: Eliminate fragile manual cursor tracking in favor of Bubbletea built-in row management so all in-place terminal updates (subject replacement, approval collapse, tool streaming, follow-up prompt) work correctly regardless of terminal width, wrapping, or interleaved output.
**Tech Stack**: Go / Bubbletea (charmbracelet) -- already a dependency
**Components**: cmd/stigmer/root/run_stream_inline*.go, cmd/stigmer/root/run_stream_inline_approval.go, cmd/stigmer/root/run_stream_inline_streaming.go, cmd/stigmer/root/run_stream_inline_followup.go, cmd/stigmer/root/run_stream_inline_header_update.go, pkg/approval/inline_prompter.go, pkg/spinner/, pkg/termctl/

## Current State
- **Status**: in-progress
- **Last Session**: March 5, 2026 -- Phase 1 (Bubbletea Program Shell) completed
- **Active Task**: T01 Architecture Design and Migration Plan -- Phase 1 done, Phase 2 next

## Session Progress (2026-03-05)
- Completed deep exploration of Bubbletea v1.2.4 API and existing renderer architecture
- Discovered 3 architectural constraints that revised the original T01 plan:
  - `tea.Println` is line-based (appends `\r\n`), cannot support token-by-token AI streaming
  - `Update()` cannot block, but approval flow blocks for raw terminal input
  - stdout/stderr split is the natural Bubbletea boundary
- Implemented Phase 1: Bubbletea Program Shell -- Foundation
  - New file: `run_stream_inline_bubbletea.go` (minimal model)
  - New file: `run_stream_inline_bubbletea_test.go` (9 tests)
  - Modified: `run_stream.go` (Program lifecycle management)
  - Modified: `run_stream_inline.go` (statusf routing, approval sentinel)
- All existing tests pass unchanged; zero visual regression

## Next Steps
1. **Phase 2: Spinner Migration** -- Move the thinking spinner into Bubbletea's `View()` so Bubbletea tracks its rows. Replace `\r\033[K` repainting with model state updates.
2. **Phase 3: Subject / Header Update** -- Move session header into `View()` and replace manual `\033[s`/`\033[u`/`\033[NA`/`\033[2K` cursor save/restore with Bubbletea re-rendering.
3. **Phase 4: Approval Flow Migration** -- Move the blocking approval flow into Bubbletea's event-driven Update cycle. Replace all 6 `termctl.EraseLines` call sites with `View()` state transitions.

## Plan Divergence (READ THIS)

The original T01 plan (`tasks/T01_0_plan.md`) assumed a "single writer / all output through tea.Println()" approach. Phase 1 implementation revealed this is not viable due to Bubbletea API constraints. A conservative integration strategy was adopted instead. The T01 plan has been marked REVISED and its phase descriptions are directional goals, not literal specs. Each phase should be re-evaluated against the actual foundation before implementation.

Key documents:
- `design-decisions/001-conservative-bubbletea-integration.md` -- full rationale and comparison table
- `wrong-assumptions/001-single-writer-all-through-println.md` -- what we got wrong and why

## Context for Resume
- Bubbletea Program is configured with `tea.WithOutput(statusW)` + `tea.WithInput(nil)` -- owns stderr, avoids stdin/stdout conflicts
- AI content continues directly to stdout via `dataW` (unchanged)
- `statusf()` routes through `program.Println()` when program is non-nil and not in approval flow
- `inApprovalFlow` sentinel ensures approval-adjacent writes bypass Bubbletea's async render queue
- Model's `View()` returns empty string -- subsequent phases progressively populate it
- Key files to read when resuming: `run_stream.go` (lifecycle), `run_stream_inline.go` (routing), `run_stream_inline_bubbletea.go` (model)

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
6. [ ] Continue with Phase 2: Spinner Migration

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260305.01.bubbletea-inline-renderer/next-task.md`

## Quick Commands

After loading context:
- "Continue with Phase 2" - Resume with spinner migration
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
