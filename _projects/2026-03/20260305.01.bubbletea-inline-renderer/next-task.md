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
- **Last Session**: March 5, 2026 -- Phase 6 (Follow-up Prompt Migration) completed
- **Active Task**: T01 Architecture Design and Migration Plan -- Phases 1-6 done, Phase 7 next

## Session Progress (2026-03-05, Session 6)
- Completed Phase 6: Follow-up Prompt Migration to Bubbletea View()
- Added 2 new message types: `followUpShowMsg`, `followUpHideMsg` with 2 model state fields
- Added 2 Update handlers (`handleFollowUpShow`, `handleFollowUpHide`) and View() followUp branch with priority `approval > streaming > followUp > spinner > empty`
- Extracted `formatFollowUpPrompt` (pure string builder), `readStdinLine` (stdin I/O), and `readFollowUpInputDirect` (direct-write compose) from the monolithic `readFollowUpInput`
- Added `promptFollowUp` branching function with `promptFollowUpViaBubbletea` and `promptFollowUpDirect` helpers
- `runInlineFollowUpLoop` simplified to delegate prompt/erase/echo to `promptFollowUp(cfg.program, cfg.status)`
- `termctl.EraseLines` on followup.go is now unreachable in the Bubbletea path — **all EraseLines are now unreachable when program != nil**
- 4 files changed, +266/-32 lines; 9 new tests, all existing tests pass (same 2 pre-existing failures)

## Previous Session Progress (2026-03-05, Session 5)
- Completed Phase 5: Tool Streaming Migration to Bubbletea View()
- Added 3 new message types: `streamingShowMsg`, `streamingUpdateMsg`, `streamingHideMsg` with 6 model state fields
- Added 3 Update handlers and View() streaming branch with priority `approval > streaming > spinner > empty`
- 4 files changed, +506/-73 lines; 14 new streaming model tests

## Previous Session Progress (2026-03-05, Session 4)
- Completed Phase 4: Approval Flow Migration to Bubbletea View()
- Adopted "hybrid" architecture: blocking event loop reads keys, Bubbletea manages rendering
- 7 files changed, +489/-128 lines; 8 new approval model tests, 5 new PromptKeyOnly/RenderMenu tests

## Previous Session Progress (2026-03-05, Session 3)
- Completed Phase 3: Header Simplification
- Deleted `lineCountingWriter`, `subjectUpdater`, and all ANSI cursor constants (362 lines removed)

## Previous Session Progress (2026-03-05, Session 2)
- Completed Phase 2: Spinner Migration to Bubbletea View()

## Previous Session Progress (2026-03-05, Session 1)
- Completed Phase 1: Bubbletea Program Shell -- Foundation

## Next Steps
1. **Phase 7: Cleanup** -- Remove dead code, audit for any remaining direct cursor manipulation, file size cleanup (bubbletea.go ~358 lines, streaming.go 321 lines, approval.go 464 lines are over the 250-line guideline).
2. **After Phase 7**: Project 20260305.02 (expand-collapse-tools) becomes unblocked.

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
- `PromptKeyOnly` reads raw keystrokes without rendering; calls `onSelect` callback to relay selection changes to Bubbletea via `program.Send(approvalSelectMsg{})`
- `approvalHideMsg` clears the panel (View()="") and commits collapsed result via `tea.Println` Cmd
- `followUpHideMsg` clears the prompt (View()="") and commits styled human message via `tea.Println` Cmd
- Pre-approval and post-approval streaming go through Bubbletea View() when program is non-nil (Phase 5)
- **All `termctl.EraseLines` calls are unreachable in the Bubbletea path** after Phase 6; direct-write fallback EraseLines preserved for program == nil
- **Session header renders directly to stderr before Bubbletea starts** (Phase 3)
- Key files: `run_stream_inline_bubbletea.go` (model + messages + handlers), `run_stream_inline_approval.go` (approval flow), `run_stream_inline_followup.go` (follow-up with Bubbletea/direct branching), `run_stream_inline.go` (routing, statusf), `pkg/approval/inline_prompter.go` (RenderMenu, PromptKeyOnly)

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
6. [ ] Continue with Phase 7: Cleanup

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260305.01.bubbletea-inline-renderer/next-task.md`

## Quick Commands

After loading context:
- "Continue with Phase 7" - Resume with cleanup
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
