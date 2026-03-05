# Bubbletea v2 Phase 5: Cleanup, Polish, and Code Review

**Date**: March 5, 2026

## Summary

Completed the final phase of the Bubbletea v2 migration with a comprehensive cleanup pass across the inline renderer, approval system, progress display, and design documentation. This phase closed an architectural gap in session-resume follow-up wiring, removed dead code, unified inconsistent UI labels, eliminated code duplication between prompters, and formalized four design decisions as permanent project documentation.

## Problem Statement

After four phases of v2 migration (mechanical API update, scrollback fix + follow-up UX, textinput replacement, and Ctrl+O unblocking), the codebase accumulated minor inconsistencies, dead code from superseded approaches, duplicated logic across prompter implementations, and undocumented architectural decisions that needed to be captured before they became tribal knowledge.

### Pain Points

- `run_session.go` was missing the `followUpEnabled` flag, silently degrading Ctrl+O UX for session-resume users
- Dead constants in `cliprint/progress.go` (`statusPending`, 7 unused phase constants, `PhaseDeploying`) from earlier iterations
- Inconsistent approval labels: "Yes" in inline prompter vs "Approve" in interactive prompter
- Inconsistent selection indicator: `>` in inline vs `▸` in interactive
- Duplicated `handleNonInteractive` logic across `InteractivePrompter` and `InlinePrompter`
- Two nearly-identical menu rendering functions (`RenderMenu`, `RenderMenuForView`)
- Stale comments referencing removed `textInputBuffer`
- Four key architectural decisions (scrollback 3J, follow-up visibility, nil-channel pattern, extend-renderer-not-model) existed only in conversation context

## Solution

Conducted a 4-way parallel audit of the entire codebase surface area touched by the v2 migration, then systematically addressed every finding through targeted fixes, refactoring, and documentation.

## Implementation Details

### Architecture Gap: Session Follow-Up Wiring
- Added `followUpEnabled: toggleExpandCh != nil && followUpFn != nil` to `inlineRenderConfig` in `run_session.go`
- This ensures session-resume users get the same Ctrl+O-during-follow-up experience as fresh stream users

### Dead Code Removal
- Removed `statusPending` constant (zero-value enum state unreachable via `SetPhase`/`CompletePhase` API)
- Removed 7 unused phase constants (`phaseDiscovering`, `phaseValidating`, `phaseConnecting`, `phaseExecuting`, `phaseDeleting`, `phaseCompleted`, `PhaseDeploying`)
- Trimmed `defaultPhaseConfig` from 8 entries to 3 (the only phases used by daemon bootstrap)

### UI Consistency
- Unified approval labels to "Approve/Skip/Reject" across both inline and interactive prompters
- Standardized selection indicator to `▸` everywhere

### Code Deduplication
- Merged `RenderMenu` and `RenderMenuForView` into single `RenderMenu(selected int, forView bool) string`
- Extracted `resolveNonInteractive(opts Options) (*Decision, error)` as a shared package-level helper in `prompter.go`
- Removed the now-redundant `handleNonInteractive` method from `InteractivePrompter`

### Constants Organization
- Moved `followUpSepWidth` and `followUpPromptRows` from `run_display.go` to `run_stream_inline_types.go` where they belong

### Documentation
- Wrote 4 new design decision documents for project 03:
  - `001-scrollback-clear-3J.md` -- `\033[3J` ANSI escape for scrollback clearing
  - `002-follow-up-prompt-always-visible.md` -- prompt stays visible across Ctrl+O toggles
  - `003-nil-channel-pattern.md` -- nil channels for conditional select cases
  - `004-extend-renderer-not-model.md` -- follow-up lifecycle in renderer, not model
- Updated 2 predecessor design decisions with v2 validation notes
- Fixed stale T01 plan content (follow-up visibility revision, phase numbering)

### Test Updates
- Updated all approval test assertions for new labels ("Yes" -> "Approve") and indicator (`>` -> `▸`)
- Updated `TestInlineBubbleModel_View_ApprovalActive_ShowsQuestionAndMenu` for unified labels
- Converted `TestHandleNonInteractive_*` tests to call shared `resolveNonInteractive` directly
- Updated `RenderMenu`/`RenderMenuForView` test callers for merged function signature

## Benefits

- **Feature parity**: Session-resume users now get the same follow-up UX as fresh stream users
- **Smaller surface area**: ~15 lines of dead code removed, reducing cognitive load
- **Consistency**: Single source of truth for approval labels and rendering across all prompter implementations
- **Maintainability**: Shared `resolveNonInteractive` eliminates a class of bugs where one prompter's non-interactive logic drifts from the other
- **Institutional knowledge**: Four architectural decisions are now permanently documented, not just in conversation history
- **Clean build**: `go vet`, `go build`, and full test suite pass with zero warnings

## Impact

- **CLI users**: Consistent "Approve/Skip/Reject" labels regardless of terminal mode; session-resume follow-up now works with Ctrl+O
- **CLI maintainers**: Cleaner codebase with less duplication, better documentation, organized constants
- **Future contributors**: Design decision docs explain the "why" behind non-obvious patterns (nil channels, scrollback 3J, renderer lifecycle)

## Related Work

- Predecessor: [Bubbletea v2 Phase 1: Mechanical API Migration](2026-03-05-204550-bubbletea-v2-mechanical-api-migration.md)
- Predecessor: [Phase 2: Scrollback Fix and Follow-Up Prompt UX](2026-03-05-212606-scrollback-fix-and-follow-up-prompt-ux.md)
- Predecessor: [Phase 3: Replace Custom Text Input with Bubbles/Textinput v2](2026-03-05-214733-replace-custom-text-input-with-bubbles-textinput-v2.md)
- Predecessor: [Phase 4: Unblock Ctrl+O During Follow-Up Prompt](2026-03-05-222122-unblock-ctrl-o-during-follow-up-prompt.md)
- Project: `_projects/2026-03/20260305.03.bubbletea-v2-upgrade/`

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (Phase 5 of 5, completing the v2 migration project)
