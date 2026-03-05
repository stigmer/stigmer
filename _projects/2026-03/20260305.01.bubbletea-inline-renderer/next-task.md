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
- **Last Session**: March 5, 2026 -- Phase 5 (Tool Streaming Migration) completed
- **Active Task**: T01 Architecture Design and Migration Plan -- Phases 1-5 done, Phase 6 next

## Session Progress (2026-03-05, Session 5)
- Completed Phase 5: Tool Streaming Migration to Bubbletea View()
- Added 3 new message types: `streamingShowMsg`, `streamingUpdateMsg`, `streamingHideMsg` with 6 model state fields
- Added 3 Update handlers (`handleStreamingShow`, `handleStreamingUpdate`, `handleStreamingHide`) and View() streaming branch with priority `approval > streaming > spinner > empty`
- Created `formatStreamingView` pure function: assembles header + content with width-clamping, line-capping, truncation indicator, and gutter-wrapping for sub-agents
- Added Bubbletea branches to all 4 streaming functions: `initPreApprovalStreaming`, `renderToolStreamDelta`, `initPostApprovalStreaming`, `completeStreamingTool` — when `program != nil`, send messages instead of direct-writing
- Extracted `renderToolStreamDeltaDirect` and `buildStreamHeaderOutput` helpers to cleanly separate direct-write and Bubbletea paths
- `erasePreApprovalContent` becomes no-op for Bubbletea path (streaming is in View; `approvalShowMsg` atomically replaces it)
- `handleNonInteractiveApproval` Bubbletea branch sends `streamingHideMsg` (with or without collapsed result) instead of `termctl.EraseLines`
- `handleApprovalShow` atomically clears streaming state — no intermediate empty frame when transitioning from streaming to approval
- All 4 target `termctl.EraseLines` call sites confirmed unreachable in the Bubbletea path; direct-write fallback EraseLines preserved
- 4 files changed, +506/-73 lines; 14 new streaming model tests, all existing tests pass (same 2 pre-existing failures)

## Previous Session Progress (2026-03-05, Session 4)
- Completed Phase 4: Approval Flow Migration to Bubbletea View()
- Adopted "hybrid" architecture: blocking event loop reads keys, Bubbletea manages rendering. Evaluated full-async alternative and determined hybrid is the simplest correct solution for current requirements.
- Exported `RenderMenu` from `pkg/approval` so the Bubbletea model can call it from `View()`
- Added `PromptKeyOnly` method to `InlinePrompter`: reads raw keystrokes without rendering the menu; calls `onSelect` callback on arrow keys for relay via `program.Send()`
- Added 3 new message types to inlineBubbleModel: `approvalShowMsg`, `approvalSelectMsg`, `approvalHideMsg`
- `View()` renders the full approval panel (expanded content + question + menu) when `approvalActive`; approval takes priority over spinner
- `approvalHideMsg` returns `tea.Println(collapsedResult)` as a Cmd -- Bubbletea's FIFO message ordering guarantees the panel clears before the collapsed result is committed
- Restructured `handleInteractiveApproval` into two paths: `promptApprovalViaBubbletea` (program != nil) and `promptApprovalDirect` (fallback for non-TTY/CI/tests)
- Extracted `erasePreApprovalContent` (shared streaming erasure), `formatCollapsedResult` (string builder for Bubbletea path), `handlePromptErrorAfterHide` (error handling when panel already hidden)
- Removed `inApprovalFlow` sentinel from `inlineRenderer` and its set/clear guards in `handleEvent`
- Simplified `statusf`: always uses `program.Println` when program is non-nil (no approval gate)
- 3 EraseLines removed from approval flow; 4 remain (2 streaming erasure + 2 streaming update -- all Phase 5 scope)
- 7 files changed, +489/-128 lines; 8 new approval model tests, 5 new PromptKeyOnly/RenderMenu tests, 2 obsolete tests removed
- All existing tests pass (2 pre-existing failures unrelated to this phase)

## Previous Session Progress (2026-03-05, Session 3)
- Completed Phase 3: Header Simplification
- Deleted `lineCountingWriter`, `subjectUpdater`, and all ANSI cursor constants (362 lines removed)
- Header renders directly to stderr before Bubbletea starts; `View()` renders at bottom

## Previous Session Progress (2026-03-05, Session 2)
- Completed Phase 2: Spinner Migration to Bubbletea View()
- Model gained spinner state with `tea.Tick` chain; `startThinkingSpinner`/`stopThinkingSpinner` route through `program.Send()`

## Previous Session Progress (2026-03-05, Session 1)
- Completed Phase 1: Bubbletea Program Shell -- Foundation
- Discovered 3 API constraints; adopted conservative integration strategy

## Next Steps
1. **Phase 6: Follow-up Prompt Migration** -- Move follow-up prompt into `View()`. This eliminates the last `termctl.EraseLines` call site in `run_stream_inline_followup.go` (line 48).
2. **Phase 7: Cleanup** -- Remove dead code, audit for any remaining direct cursor manipulation, file size cleanup (streaming.go 320 lines, bubbletea.go 312 lines, approval.go 464 lines are over the 250-line guideline).

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
- **Model's `View()` now renders streaming content** when `streamingActive` (Phase 5) -- header + width-clamped/line-capped content for pre-approval, uncapped for post-approval
- **View() priority**: `approval > streaming > spinner > empty` -- approval atomically replaces streaming (no intermediate empty frame)
- **Model's `View()` renders the thinking spinner** when active (Phase 2) -- returns "" when inactive
- `PromptKeyOnly` reads raw keystrokes without rendering; calls `onSelect` callback to relay selection changes to Bubbletea via `program.Send(approvalSelectMsg{})`
- `approvalHideMsg` clears the panel (View()="") and commits collapsed result via `tea.Println` Cmd -- FIFO ordering guarantees correct sequencing
- Pre-approval and post-approval streaming now go through Bubbletea View() when program is non-nil (Phase 5); direct-write fallback preserved for program == nil
- **Session header renders directly to stderr before Bubbletea starts** (Phase 3)
- Key files: `run_stream_inline_bubbletea.go` (model + messages + handlers), `run_stream_inline_approval.go` (approval flow with Bubbletea/direct-write branching), `run_stream_inline.go` (routing, statusf), `pkg/approval/inline_prompter.go` (RenderMenu, PromptKeyOnly)

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
6. [ ] Continue with Phase 6: Follow-up Prompt Migration

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260305.01.bubbletea-inline-renderer/next-task.md`

## Quick Commands

After loading context:
- "Continue with Phase 6" - Resume with follow-up prompt migration
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
