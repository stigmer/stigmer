# Replace Custom Text Input with bubbles/textinput v2

**Date**: March 5, 2026

## Summary

Replaced the 20-line custom rune buffer (`handleTextInputKey`) with `bubbles/v2/textinput` as a child model inside the Bubbletea inline renderer. The follow-up prompt now supports cursor movement, word navigation, line editing, and native paste -- matching the editing experience users expect from any modern terminal input.

## Problem Statement

The follow-up prompt's text input was a minimal hand-rolled buffer that only supported character append, backspace (rune-aware), enter, ctrl+c/d, and space. Users had no way to move the cursor within their text, jump by word, delete words, or paste from the clipboard.

### Pain Points

- Pressing left/right arrow did nothing -- typos required backspacing to the error
- No word-level navigation (Ctrl+Left/Right, Alt+B/F)
- No word or line deletion (Ctrl+W, Ctrl+U, Ctrl+K)
- No paste support (Ctrl+V or terminal paste)
- No Home/End to jump to start/end of input
- No delete-forward (Delete key)

## Solution

Embedded `bubbles/v2/textinput` as a child component in `inlineBubbleModel`. The textinput manages all keystroke-to-value logic (cursor, editing, paste). The parent model's `handleTextInputKey` becomes a thin interceptor that only handles submit (Enter), cancel (Ctrl+C), and EOF (Ctrl+D on empty input). All other keys delegate to `textinput.Update(msg)`.

Used real cursor mode (`SetVirtualCursor(false)`) so that `textinput.Cursor()` returns a `*tea.Cursor` for the parent to offset into the composed layout (separator + input + hint), consistent with Phase 2's cursor positioning approach.

## Implementation Details

**3 files changed, +172/-108 lines**

### Model changes (`run_stream_inline_bubbletea.go`)

- Replaced `textInputBuffer string` with `textInput textinput.Model`
- Added `newFollowUpTextInput()` factory: configures real cursor, prompt style (bold blue `"> "`), blinking bar cursor
- Updated constructors (`newInlineBubbleModel`, `newInlineBubbleModelWithChannels`) to initialize textinput
- `renderTextInputView()` now uses `textInput.View()` for the input line and `textInput.Cursor()` with Y+2 offset for cursor positioning
- `handleTextInputStart/Hide` use `Reset()/Focus()/Blur()` instead of manual string clearing
- Added `tea.PasteMsg` routing to textinput in `Update()`
- Removed `github.com/charmbracelet/x/ansi` import (cursor logic delegated to textinput)

### Key handler changes (`run_stream_inline_keypress.go`)

- `handleTextInputKey` reduced from manual buffer management to a 17-line thin interceptor
- Enter: submits `textInput.Value()`
- Ctrl+C: submits empty (exit)
- Ctrl+D: Unix dual behavior -- empty input = EOF (exit), non-empty = delete forward char
- All other keys: delegated to `textInput.Update(msg)`
- Removed `unicode/utf8` import

### Test changes (`run_stream_inline_keypress_test.go`)

- Updated all existing text input tests to use `textInput.Value()` and `textInput.SetValue()`
- Added `newFocusedTextInputModel()` test helper
- Added 4 new tests: Ctrl+D dual behavior, cursor movement (left/right), Home/End, paste via `tea.PasteMsg`
- 22 related tests passing

## Benefits

- Full readline-style editing in follow-up prompt (cursor movement, word nav, line editing)
- Native paste support (`tea.PasteMsg` + Ctrl+V)
- Horizontal scroll viewport for long inputs
- 108 lines of custom buffer code removed, replaced by a proven component
- Ctrl+D follows Unix convention (empty=EOF, non-empty=delete forward)
- Consistent with the approval prompt's existing textinput usage (`pkg/approval/prompt_model.go`)

## Impact

- **End users**: Follow-up prompt now has the editing capabilities they expect from any terminal input
- **Maintainers**: Less custom code to maintain; textinput is an upstream component with its own test suite
- **Architecture**: Establishes the child-model delegation pattern for future embedded components

## Related Work

- Phase 1: Mechanical v1-to-v2 API migration (`2026-03-05-204550`)
- Phase 2: Scrollback fix and follow-up prompt UX overhaul (`2026-03-05-212606`)
- Phase 4 (next): Unblock Ctrl+O during follow-up prompt
- Phase 5 (next): Cleanup legacy paths, polish

---

**Status**: ✅ Production Ready
**Timeline**: Phase 3 of Bubbletea v2 upgrade (T01)
