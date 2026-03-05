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
**Status**: Phase 2 COMPLETE -- ready for Phase 3
**Last Session**: 2026-03-05 (Session 3 -- Phase 2: scrollback fix + follow-up prompt UX)

## Session Progress (2026-03-05, Session 3)

### Accomplished
- **Part A: Scrollback Duplication Fix**
  - Added `\033[3J` (Erase Saved Lines) direct write to `triggerReCommit()` -- eliminates scrollback duplication on Ctrl+O toggle and approval collapse
  - Enabled subject update re-commit -- header now updates visually when the backend resolves the session subject
- **Part B: Follow-up Prompt UX Overhaul**
  - Added `termWidth` tracking via `tea.WindowSizeMsg` to `inlineBubbleModel`
  - New prompt layout: full-width separator → `> input` → hint footer (hint moved below input)
  - Real blinking bar cursor on the input line via `tea.View.Cursor`
  - Removed `textInputPrompt` field -- prompt now rendered dynamically in `View()` using model state
  - Simplified `textInputStartMsg` (removed `prompt` field) and `promptFollowUpViaChannel`
  - Updated 3 existing tests, added 4 new tests (cursor position, width separator, WindowSizeMsg)

### Key Decisions
- `\033[3J` via direct write to `cfg.status` (Option 1) -- safe because it only affects scrollback
- `followUpSepWidth` kept as fallback for legacy paths (direct-write, key-reader)
- Legacy follow-up paths keep hint-above-input layout (no cursor API available)

### Files Modified (Phase 2)
- `run_stream_inline_history.go` -- `\033[3J` in `triggerReCommit()`
- `run_stream_inline.go` -- subject update re-commit
- `run_stream_inline_bubbletea.go` -- `termWidth`, `renderTextInputView()`, cursor positioning
- `run_stream_inline_messages.go` -- simplified `textInputStartMsg`
- `run_stream_inline_followup.go` -- simplified `promptFollowUpViaChannel`
- `run_display.go` -- updated `followUpSepWidth` comment
- `run_stream_inline_keypress_test.go` -- updated + new tests

## Next Steps

1. **Phase 3**: Replace custom `handleTextInputKey` with `bubbles/textinput` v2
2. **Phase 4**: Unblock Ctrl+O during follow-up prompt
3. **Phase 5**: Cleanup legacy paths, polish, update design decision docs

## Context for Resume

- Phase 2 is fully implemented and all tests pass (build + vet + tests green)
- `tea.View.Cursor` is now used for cursor positioning in the follow-up prompt -- not yet visually verified in a live terminal
- `ansi.StringWidth()` from `x/ansi` is the correct way to compute visual width of styled text for cursor X
- `renderTextInputView()` method on `inlineBubbleModel` is the new follow-up prompt renderer
- Legacy follow-up paths (`promptFollowUpDirect`, `promptFollowUpViaKeyReader`) are unchanged
- `followUpSepWidth = 40` is still used as fallback when `termWidth` is 0

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
6. [ ] Continue with Phase 3

## Implementation Phases (from T01 plan)

1. **Phase 1**: ~~Mechanical v1-to-v2 API migration~~ **COMPLETE**
2. **Phase 2**: ~~Re-commit scrollback fix + follow-up prompt UX overhaul~~ **COMPLETE**
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
- "Continue with Phase 3" - Start replacing custom text input with bubbles/textinput v2
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
