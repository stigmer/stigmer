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
**Current Task**: T02 — Phase 3 (Ctrl+O Keybinding Wiring)
**Status**: Ready to begin Phase 3
**Last Session**: 2026-03-05

## Session Progress (2026-03-05, Session 2)

### Completed
- **T02 Phase 2**: Expanded renderers + re-commit wiring — all 4 steps complete

### What Was Built
- `RenderExpanded(tc, opts)` — routes by tool type, delegates to compact for unchanged tools (read, write, delete), uses expanded renderers for shell/think/discovery/unknown
- `RenderReadGroupExpanded(reads, opts)` — shows ALL entries with no `maxVisibleInGroup` cap
- 4 internal expanded renderers: `renderExpandedShell`, `renderExpandedThink`, `renderExpandedDiscovery`, `renderExpandedUnknown`
- `expanded bool` parameter threaded through `renderCommittedItem`, `reCommitHistory`, `reCommitMsg`, and `handleReCommit`
- 41 new tests in `render_expanded_test.go` + 7 expanded variants in `run_stream_inline_history_test.go`

### Design Decisions (Phase 2)
1. **Expanded read groups show all entries, no file content** — hyperlinked paths are clickable; showing file content would clutter the view. Expanded mode is a quick scannable list.
2. **Read/write/delete identical in both modes** — `RenderExpanded` delegates directly to compact renderers for these tools. No truncation to lift.
3. **Shell/think/discovery/unknown show all output** — truncation limits (`maxShellOutputLines`, `maxThinkLines`, `maxUnknownOutputLines`) are bypassed in expanded mode.
4. **`triggerReCommit` sends `expanded: false` for now** — subject update is always compact. Phase 3 will thread the actual expand state.
5. **`CompactOptions` naming deferred** — struct carries general rendering config (hyperlinks, workspace roots) used by both modes. Rename to `RenderOptions` in a future cleanup pass.

### Files Created (2)
- `client-apps/cli/pkg/toolrender/render_expanded.go` — `RenderExpanded`, `RenderReadGroupExpanded`, 4 internal expanded renderers (196 lines)
- `client-apps/cli/pkg/toolrender/render_expanded_test.go` — 41 tests covering all tool types in expanded mode

### Files Modified (5)
- `run_stream_inline_history.go` — `expanded bool` parameter on `renderCommittedItem`, `renderToolCompactItem`, `renderReadGroupItem`, `reCommitHistory`
- `run_stream_inline_messages.go` — `expanded bool` field on `reCommitMsg`
- `run_stream_inline_bubbletea.go` — `handleReCommit` passes `msg.expanded` through
- `run_stream_inline_history_test.go` — 14 existing tests updated with `expanded: false`, 7 new expanded variants added
- `client-apps/cli/pkg/toolrender/BUILD.bazel` — added `render_expanded.go` and `render_expanded_test.go`

## Previous Session Progress (2026-03-05, Session 1)

### Completed
- **T01**: Plan approved (T01_0_plan.md)
- **T02 Phase 1**: Fully implemented — all 7 steps complete

### Key Decisions Made (Phase 1)
1. **History lives on `inlineRenderer`**, not the Bubbletea model — synchronous appends, no races
2. **AI content replayed to stderr** during re-commit — preserves stdout pipe compatibility
3. **Session header stays as pre-Bubbletea direct write** — renderer stores it as `history[0]` for re-commit only
4. **Pre-rendered text for mode-invariant items** (AI, system, lifecycle messages); **structured data for mode-variable items** (tool calls, read groups, approvals, header)
5. **`sessionSubject` dead parameter replaced** with `sessionHeaderInfo` struct threaded through the entire call chain

### Discoveries During Implementation (Phase 1)
1. **stdout/stderr tension with ClearScreen** — `tea.ClearScreen` erases entire terminal including stdout AI content; resolved by replaying everything to stderr during re-commit
2. **`resumeSession` bypasses Bubbletea** — subject update irrelevant there (subject already resolved); Phase 4 will need Bubbletea for Ctrl+O
3. **`sessionSubject` was dead code** — replaced with structured `sessionHeaderInfo`
4. **BUILD.bazel had phantom file references** — pre-allocated for this work; files now created

## Next Steps

1. **T02 Phase 3**: Ctrl+O keybinding wiring — add `expandMode` to Bubbletea model, Bubbletea owns stdin, Ctrl+O triggers `triggerReCommit` with `expanded: true`
2. **T02 Phase 4**: Follow-up history recording, resumed session Bubbletea support
3. **T02 Phase 5**: Performance profiling for long sessions

## Context for Resume

- Phase 2 plan: `.cursor/plans/phase_2_expanded_renderers_8bdf5824.plan.md`
- Phase 1 plan: `.cursor/plans/phase_1_event_history_0eda7a7b.plan.md`
- T01 plan: `_projects/2026-03/20260305.02.expand-collapse-tools/tasks/T01_0_plan.md`
- Two pre-existing test failures (`TestHandleApproval_DoesNotSuppressOnReject`, `TestInlineRenderer_ToolCompleted_ShowsBadge`) are NOT from this work — they fail on the base commit
- `go vet` passes clean; all new tests pass (41 expanded + 7 history expanded + all existing)
- Phase 3 requires stdin ownership change — currently `tea.WithInput(nil)`. This intersects with the approval flow (which reads stdin separately). Significant architectural decision needed.

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
- "Continue with Phase 3" - Resume with Ctrl+O keybinding wiring
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
