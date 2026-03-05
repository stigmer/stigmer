# Bubbletea v2 Mechanical API Migration (Phase 1)

**Date**: March 5, 2026

## Summary

Completed the full mechanical migration of the Stigmer CLI from Bubbletea v1 (charmbracelet/bubbletea) to Bubbletea v2 (charm.land/bubbletea/v2), along with all companion libraries: Lipgloss v2, Bubbles v2, and Glamour v2. This is Phase 1 of a 5-phase project to leverage v2's native cursor positioning, declarative views, and advanced keyboard handling. Zero UX regressions -- all tests pass, build is clean.

## Problem Statement

The Stigmer CLI's TUI layer was built on Bubbletea v1, which lacked native cursor positioning, declarative view structs, and modern key handling. The v1 API used `tea.KeyMsg` as a concrete struct, `View() string` for rendering, and `lipgloss.TerminalColor` for color abstraction -- all of which changed in v2. Staying on v1 blocked access to v2 capabilities needed for follow-up prompt UX improvements, proper cursor placement, and `bubbles/textinput` v2 integration.

### Pain Points

- v1 `tea.KeyMsg` struct replaced by v2 `tea.KeyMsg` interface + `tea.KeyPressMsg` concrete type
- `View() string` replaced by `View() tea.View` (declarative view struct)
- Key handling via `msg.Type` / `msg.Runes` replaced by `msg.String()` / `msg.Text` / `msg.Code`
- `lipgloss.TerminalColor` removed in v2, replaced by standard `image/color.Color`
- All import paths changed from `github.com/charmbracelet/*` to `charm.land/*/v2`
- Bazel module names changed accordingly

## Solution

Systematic, file-by-file migration following a strict plan: pre-flight compatibility checks, dependency updates, import path migration, API surface migration, test migration, build system updates, and comprehensive verification. All changes were mechanical with no behavioral modifications -- preserving exact UX parity with the v1 codebase.

## Implementation Details

### Dependencies Updated (go.mod)
- `charm.land/bubbletea/v2` v2.0.1 (was `github.com/charmbracelet/bubbletea` v1.2.4)
- `charm.land/lipgloss/v2` v2.0.0 (was `github.com/charmbracelet/lipgloss` v1.0.0)
- `charm.land/bubbles/v2` v2.0.0 (was `github.com/charmbracelet/bubbles` v0.20.0)
- `charm.land/glamour/v2` v2.0.0-20260302162937-86f90cfe96d1 (was `github.com/charmbracelet/glamour` v0.8.0)
- `github.com/charmbracelet/x/ansi` bumped transitively to v0.11.6 (was v0.8.0)

### Import Path Migration (20 source + 4 test files)
All `github.com/charmbracelet/{bubbletea,lipgloss,bubbles/*,glamour}` imports updated to `charm.land/*/v2` equivalents across the codebase.

### Bubbletea API Migration
- `Update()` switch cases: `tea.KeyMsg` → `tea.KeyPressMsg` (3 models)
- `View()` signatures: `View() string` → `View() tea.View` with `tea.NewView(content)` (3 models)
- Handler functions: `handleKeyPress`, `handleApprovalKey`, `handleTextInputKey`, `handleIdleKey` accept `tea.KeyPressMsg`
- `handleTextInputKey`: complete rewrite from `switch msg.Type` / `msg.Runes` to `switch msg.String()` / `msg.Text`

### Lipgloss v2 Adaptation
- `lipgloss.TerminalColor` removed → `ResolveColor()` returns `color.Color` (standard library)
- Lipgloss v2 always emits ANSI codes even to non-TTY writers → 5 integration tests updated with `ansi.Strip()`

### Test Migration (~47 constructions across 3 test files)
- All `tea.KeyMsg{Type: tea.KeyCtrlO}` patterns → `tea.KeyPressMsg{Code: 'o', Mod: tea.ModCtrl}`
- All `tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}` → `tea.KeyPressMsg{Code: 'j', Text: "j"}`
- All `model.View()` string assertions → `model.View().Content` comparisons

### Build System (7 BUILD.bazel + MODULE.bazel)
Bazel dependency labels updated from `@com_github_charmbracelet_*` to `@land_charm_*_v2` across all affected packages.

## Benefits

- **Unblocks v2 capabilities**: Cursor positioning, declarative views, and advanced key handling are now available for Phases 2-5
- **Modern API surface**: Idiomatic v2 patterns (`msg.String()`, `tea.NewView()`, `tea.KeyPressMsg`) throughout
- **Zero regressions**: All 40+ tests pass, `go build` clean, `go vet` clean
- **Clean dependency graph**: No lingering v1 references in go.mod or BUILD files

## Impact

- **Scope**: 20 source files, 4 test files, 8 build files, dependency manifests (40 files total)
- **Net change**: +334 lines, -263 lines
- **Packages affected**: `cmd/stigmer/root`, `pkg/approval`, `pkg/panel`, `pkg/toolrender`, `pkg/mdrender`, `internal/cli/cliprint`
- **Risk**: Minimal -- mechanical migration with full test coverage, no behavioral changes

## Related Work

- **20260305.01** (bubbletea-inline-renderer): Original Bubbletea v1 integration
- **20260305.02** (expand-collapse-tools): Event history, Ctrl+O, follow-up prompt built on v1
- **Phase 2** (upcoming): Follow-up prompt UX overhaul using v2 cursor positioning
- **Phase 3** (upcoming): Replace custom text input with bubbles/textinput v2

---

**Status**: ✅ Production Ready (Phase 1 of 5)
**Timeline**: Single session (~2 hours)
