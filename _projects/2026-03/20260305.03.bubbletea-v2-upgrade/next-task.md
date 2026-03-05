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
**Status**: Phase 1 COMPLETE -- ready for Phase 2
**Last Session**: 2026-03-05 (Session 2 -- Phase 1 mechanical v2 migration)

## Session Progress (2026-03-05, Session 2)

### Accomplished
- Completed full Phase 1: Mechanical v1-to-v2 API migration
- All 4 charmbracelet dependencies upgraded: bubbletea v2.0.1, lipgloss v2.0.0, bubbles v2.0.0, glamour v2 (pseudoversion)
- x/ansi bumped transitively from v0.8.0 to v0.11.6
- 20 source files updated (imports + API changes)
- 4 test files updated (~47 KeyMsg constructions + View() assertions)
- 7 BUILD.bazel + MODULE.bazel updated
- go build, go vet, all tests pass

### Key Decisions
- **glamour v2**: Included in Phase 1 (no stable tag yet, using pseudoversion v2.0.0-20260302162937-86f90cfe96d1)
- **lipgloss.TerminalColor → color.Color**: v2 removed the TerminalColor interface; replaced with standard image/color.Color
- **View() refactored to switch-case**: The multi-return View() on inlineBubbleModel was refactored to a single-return switch for cleanliness

### Surprises Discovered & Resolved
1. `lipgloss.TerminalColor` removed in v2 -- clean fix, replaced with `color.Color`
2. Lipgloss v2 always emits ANSI codes (v1 auto-stripped for non-TTY) -- 5 integration tests needed `ansi.Strip()` before substring assertions
3. `glamour/v2` not released as a stable tag -- using pseudoversion

### Files Modified (v2 migration only)
- 20 source files (imports + API)
- 4 test files (KeyMsg→KeyPressMsg, View().Content, ansi.Strip)
- 7 BUILD.bazel + MODULE.bazel
- go.mod, go.sum, go.work.sum

## Next Steps

1. **Phase 2**: Follow-up prompt UX overhaul (v2 cursor positioning -- footer below input)
2. **Phase 3**: Replace custom text input with bubbles/textinput v2
3. **Phase 4**: Unblock Ctrl+O during follow-up prompt
4. **Phase 5**: Cleanup legacy paths, polish, update design decision docs

## Context for Resume

- Phase 1 is fully committed and green (build + vet + tests)
- The v2 API surface is now available for Phases 2-5
- Key v2 capability to leverage next: `tea.View.Cursor` for cursor positioning in follow-up prompt
- `tea.NewView(content)` is the new pattern for all View() methods
- `tea.KeyPressMsg` with `msg.String()` is the idiomatic key handling pattern
- Lipgloss v2 always applies styles even in tests -- use `ansi.Strip()` when comparing styled output

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

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any new design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 2

## Implementation Phases (from T01 plan)

1. **Phase 1**: ~~Mechanical v1-to-v2 API migration~~ **COMPLETE**
2. **Phase 2**: Follow-up prompt UX overhaul (v2 cursor positioning -- footer below input)
3. **Phase 3**: Replace custom text input with bubbles/textinput v2
4. **Phase 4**: Unblock Ctrl+O during follow-up prompt (deferred limitation resolved)
5. **Phase 5**: Cleanup legacy paths, polish, update design decision docs

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

## Quick Commands

After loading context:
- "Continue with Phase 2" - Start the follow-up prompt UX overhaul
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
