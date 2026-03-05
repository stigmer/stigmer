# Next Task: 20260305.03.bubbletea-v2-upgrade

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260305.03.bubbletea-v2-upgrade

**Description**: Upgrade Bubbletea from v1.2.4 to v2.0.x across the Stigmer CLI, then leverage v2 native capabilities (cursor positioning, declarative View, real cursor, advanced keyboard handling) to resolve design compromises and deferred work from projects 01 (bubbletea-inline-renderer) and 02 (expand-collapse-tools).
**Goal**: Complete v2 migration with zero UX regression, then use v2 cursor positioning for the follow-up prompt UX overhaul, replace custom text input with bubbles/textinput v2, and unblock Ctrl+O during follow-up prompt.
**Tech Stack**: Go / Bubbletea v2 (charmbracelet) / Lipgloss v2 / Bubbles v2
**Components**: inline renderer (run_stream_inline*.go), Bubbletea model (run_stream_inline_bubbletea.go), keypress handlers, follow-up prompt, approval flow (pkg/approval/), progress display (cliprint/progress.go), panel/toolrender styling packages

## Current Status

**Created**: 2026-03-05 11:00
**Current Task**: T01 -- Bubbletea v2 Migration + Design Decision Cleanup
**Status**: COMPLETE -- all 5 phases done
**Last Session**: 2026-03-05 (Session 6 -- Phase 5: Cleanup, Polish, and Code Review)

## Session Progress (2026-03-05, Session 6)

### Accomplished
- **Phase 5: Cleanup, Polish, and Code Review**
  - Wired `followUpEnabled` in `run_session.go` (feature gap -- session-resume users now get Ctrl+O during follow-up)
  - Removed dead code: `statusPending`, 7 unused phase constants, `PhaseDeploying`; trimmed `defaultPhaseConfig` to 3 active phases
  - Unified approval labels ("Yes" -> "Approve", `>` -> `▸`) across both prompters
  - Merged `RenderMenu`/`RenderMenuForView` into single parameterized `RenderMenu(selected, forView)` function
  - Extracted shared `resolveNonInteractive()` helper, eliminating duplication between `InteractivePrompter` and `InlinePrompter`
  - Moved `followUpSepWidth`/`followUpPromptRows` to `run_stream_inline_types.go`
  - Documented `promptApprovalViaKeyReader` as test-only reachable, `approvalActionByIndex` default-to-Skip rationale
  - Fixed stale comments in `run_stream_inline_messages.go`
  - Wrote 4 new design decision docs (scrollback 3J, follow-up always visible, nil-channel pattern, extend-renderer-not-model)
  - Updated 2 predecessor design decisions with v2 validation notes
  - Fixed stale T01 plan content (follow-up visibility, phase numbering)
  - Build + vet + full test suite: clean

### Key Decisions
- `filepath` import in `render_compact.go` confirmed used (6 call sites) -- audit false positive, no action
- Keep `promptApprovalViaKeyReader` with doc comment rather than remove (test infrastructure dependency)
- `statusPending` safely removable: zero-value enum state never reachable via `SetPhase`/`CompletePhase` API

## Project Completion Summary

All 5 phases of the Bubbletea v2 migration are complete:

1. **Phase 1**: Mechanical v1-to-v2 API migration -- COMPLETE
2. **Phase 2**: Re-commit scrollback fix + follow-up prompt UX overhaul -- COMPLETE
3. **Phase 3**: Replace custom text input with bubbles/textinput v2 -- COMPLETE
4. **Phase 4**: Unblock Ctrl+O during follow-up prompt -- COMPLETE
5. **Phase 5**: Cleanup, polish, design decision docs -- COMPLETE

### Deferred Items (candidates for future cleanup projects)
- `handleEvent` refactoring (large function, but functional and tested)
- Dual tool category maps consolidation
- `formatStreamingView` off-by-one edge case
- `handleApprovalShow`/`handleApprovalStart` consolidation
- `progress.go` sleep removal
- Cursor positioning visual verification in a live terminal

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.03.bubbletea-v2-upgrade/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.03.bubbletea-v2-upgrade/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.03.bubbletea-v2-upgrade/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.03.bubbletea-v2-upgrade/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.03.bubbletea-v2-upgrade/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.03.bubbletea-v2-upgrade/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260305.03.bubbletea-v2-upgrade/dont-dos/
```

## Predecessor Projects (context)

- **20260305.01** (bubbletea-inline-renderer): Migrated ANSI cursor math to Bubbletea v1 inline mode
- **20260305.02** (expand-collapse-tools): Built event history, Ctrl+O, follow-up prompt, stdin ownership

Key predecessor documents:
- `_projects/2026-03/20260305.01.bubbletea-inline-renderer/design-decisions/001-conservative-bubbletea-integration.md`
- `_projects/2026-03/20260305.01.bubbletea-inline-renderer/design-decisions/002-header-stays-committed.md`
- `_projects/2026-03/20260305.01.bubbletea-inline-renderer/wrong-assumptions/001-single-writer-all-through-println.md`
- `_projects/2026-03/20260305.02.expand-collapse-tools/design-decisions/ctrl-o-during-follow-up-prompt.md`

## v2 Key References

- Bubbletea v2 release: https://github.com/charmbracelet/bubbletea/releases/tag/v2.0.0
- What's new in v2: https://github.com/charmbracelet/bubbletea/discussions/1374
- v2 cursor API: `tea.View.Cursor = &tea.Cursor{Position: tea.Position{X, Y}, Shape, Blink, Color}`
- v2 import: `charm.land/bubbletea/v2`, `charm.land/lipgloss/v2`, `charm.land/bubbles/v2`
- textinput real cursor: `textinput.SetVirtualCursor(false)` + `textinput.Cursor()` returns `*tea.Cursor`

---

*This file provides direct paths to all project resources for quick context loading.*
