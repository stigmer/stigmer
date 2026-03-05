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
**Status**: Phase 3 COMPLETE -- ready for Phase 4
**Last Session**: 2026-03-05 (Session 4 -- Phase 3: replace custom text input with bubbles/textinput v2)

## Session Progress (2026-03-05, Session 4)

### Accomplished
- **Phase 3: Replace Custom Text Input with bubbles/textinput v2**
  - Embedded `textinput.Model` from `charm.land/bubbles/v2/textinput` as child component in `inlineBubbleModel`
  - Configured real cursor mode (`SetVirtualCursor(false)`) for `textinput.Cursor()` integration
  - `handleTextInputKey` reduced to thin interceptor: Enter, Ctrl+C, Ctrl+D (Unix dual behavior), all else delegated to `textInput.Update(msg)`
  - `renderTextInputView()` now uses `textInput.View()` + `textInput.Cursor()` with Y+2 offset
  - Added `tea.PasteMsg` routing in `Update()` for native paste support
  - Removed `textInputBuffer string` field, `unicode/utf8` import, `x/ansi` import
  - Added `newFollowUpTextInput()` factory with promptStyle reuse
  - Updated + added tests: 22 related tests, all passing
  - Build + vet + full test suite: clean

### Key Decisions
- Real cursor (not virtual): `SetVirtualCursor(false)` for consistency with Phase 2's `tea.View.Cursor`
- Ctrl+D dual behavior: empty = EOF exit, non-empty = delete forward char (Unix convention)
- `promptStyle` reused from `run_display.go` (no lipgloss import duplication)
- `tea.PasteMsg` explicit routing (dedicated case, not catch-all default)

### Files Modified (Phase 3)
- `run_stream_inline_bubbletea.go` -- model field change, factory, constructors, renderTextInputView, start/hide handlers, PasteMsg routing
- `run_stream_inline_keypress.go` -- handleTextInputKey rewritten as thin interceptor
- `run_stream_inline_keypress_test.go` -- all text input tests updated, 4 new tests added

## Next Steps

1. **Phase 4**: Unblock Ctrl+O during follow-up prompt
2. **Phase 5**: Cleanup legacy paths, polish, update design decision docs

## Context for Resume

- Phase 3 is fully implemented and all tests pass (build + vet + tests green)
- `textinput.Model` is embedded in `inlineBubbleModel` with real cursor mode
- `textinput.Cursor()` returns `*tea.Cursor` only when `SetVirtualCursor(false)` AND `Focused()` -- nil otherwise
- `handleTextInputKey` intercepts Enter/Ctrl+C/Ctrl+D before delegating to textinput -- the interceptor pattern allows the textinput to handle all editing while we control submit/cancel
- `newFollowUpTextInput()` factory configures: real cursor, prompt `"> "`, promptStyle on Focused.Prompt, CursorBar+Blink
- Legacy follow-up paths (`promptFollowUpDirect`, `promptFollowUpViaKeyReader`) are unchanged
- `followUpSepWidth = 40` is still used as fallback when `termWidth` is 0
- Cursor positioning via textinput.Cursor() not yet visually verified in a live terminal (carried from Session 3)
- `textinput.Cursor()` computes X using rune count (not visual width) -- known CJK limitation in upstream library, irrelevant for typical usage

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
6. [ ] Continue with Phase 4

## Implementation Phases (from T01 plan)

1. **Phase 1**: ~~Mechanical v1-to-v2 API migration~~ **COMPLETE**
2. **Phase 2**: ~~Re-commit scrollback fix + follow-up prompt UX overhaul~~ **COMPLETE**
3. **Phase 3**: ~~Replace custom text input with bubbles/textinput v2~~ **COMPLETE**
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
- textinput real cursor: `textinput.SetVirtualCursor(false)` + `textinput.Cursor()` returns `*tea.Cursor`

## Quick Commands

After loading context:
- "Continue with Phase 4" - Start unblocking Ctrl+O during follow-up prompt
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
