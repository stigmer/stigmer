# CLI Rich Approval Experience with Bubbletea and Lipgloss

**Date**: February 14, 2026

## Summary

Transformed the Stigmer CLI approval UX from plain-text prompts to a polished, interactive experience using Bubbletea for selection and lipgloss for styled panel rendering. Approval requests now appear in visually distinct box-drawn panels with tool-type-aware argument formatting, replacing the Survey library dependency entirely. The new approval prompt supports vim/arrow key navigation, optional rejection comments, and gracefully degrades in non-TTY environments.

## Problem Statement

The existing CLI approval flow had several usability issues that made it difficult for users to understand what they were approving:

### Pain Points

- **Plain-text approval display**: Approval requests appeared as basic formatted text with dashes as separators, lacking visual distinction from surrounding output
- **Generic argument display**: Tool arguments were shown as raw JSON with uniform formatting, making it hard to identify the critical decision-relevant information
- **Survey dependency**: The Survey library added a dependency solely for a simple approve/skip/reject selection
- **No visual hierarchy**: All parts of the approval request had equal visual weight — tool name, arguments, metadata — making it hard to scan quickly
- **Inconsistent styling**: Approval prompts didn't match the polished look of other CLI features using Bubbletea

## Solution

Implemented a comprehensive approval UX upgrade across three key areas:

1. **Panel Rendering**: Created a reusable lipgloss-based panel renderer (`pkg/panel/`) that draws bordered boxes around approval content with customizable styles and inline titles
2. **Smart Argument Formatting**: Built a tool-type-aware formatter (`pkg/approval/formatter.go`) that highlights the most decision-relevant field for each tool category (e.g., "command" for shell tools, "path" for file operations)
3. **Bubbletea Selection**: Replaced Survey with a custom Bubbletea model that handles arrow/vim navigation, optional rejection comments, and two-phase interaction

## Implementation Details

### Panel Renderer (`pkg/panel/`)

- Pure lipgloss static rendering — no Bubbletea dependency
- `PanelStyle` enum for color theming (Default, Warning, Error, Success)
- Inline title rendering in the top border (e.g., `╭─ APPROVAL REQUIRED ───╮`)
- Configurable width with intelligent defaults (70 chars or terminal width - 10)
- 15 tests covering rendering, width detection, styles, and edge cases

### Tool-Type-Aware Formatter (`pkg/approval/formatter.go`)

- Extensible tool category map defining primary fields for known tool types:
  - Shell tools → highlight `command`
  - File write tools → highlight `path`
  - File delete tools → highlight `path` with danger styling (red/bold)
  - Read tools → highlight `path` with dimmed styling (low risk)
- Alphabetical secondary field display for full context
- Graceful fallback for unknown tools and malformed JSON
- 26 tests covering all tool categories, edge cases, and formatting behavior

### Bubbletea Approval Model (`pkg/approval/prompt_model.go`)

- Two-phase interaction:
  - **Phase 1 (Selection)**: Arrow keys (↑↓) or vim keys (j/k) to navigate, Enter to select, Ctrl+C to cancel
  - **Phase 2 (Comment)**: Only for Reject — optional text input for rejection reason
- Inline rendering (no alternate screen) for seamless integration with streaming output
- Lipgloss-styled options with active indicator (`▸`), bold active choice, dimmed inactive choices
- Keyboard hints displayed at bottom in italicized dim text
- 22 tests covering navigation, selection, cancellation, phase transitions, and view rendering

### Modified Display Logic

- `run_display_approval.go`: Rewritten to use `panel.Render()` and `formatter.FormatArgs()`
- Content builder assembles labeled sections (Tool, From, Message, Arguments, Waiting duration)
- Sub-agent indicator only shown when `FromSubAgent` is true
- Keeps existing `formatWaitingDuration()` function (well-tested, no changes needed)
- Updated 10 existing tests to match new panel format assertions

### Dependency Cleanup

- Removed Survey library entirely (zero references in Go source)
- Updated BUILD.bazel files to use charmbracelet deps (bubbletea, bubbles, lipgloss)
- Added panel dep to root package BUILD.bazel
- Created shared test helper file (`test_helpers_test.go`) for `captureStdout` function

## Benefits

- **Visual clarity**: Approval panels are unmistakable with bordered boxes and yellow warning styling
- **Decision-relevant info first**: Users immediately see the most important field (command, path, etc.) in bold
- **Consistent UX**: Approval prompts now match the polished look of progress indicators and other Bubbletea components
- **Reduced dependencies**: One less external dependency (Survey) to maintain
- **Extensible**: Tool category map is trivial to extend as new agent capabilities are added
- **Non-TTY safe**: Graceful degradation to non-interactive mode with default actions
- **100% test coverage**: 63 new tests across panel, formatter, and prompt model

## Impact

### User Experience

- Approval requests are now visually distinct and scannable — users can quickly identify what's being requested
- Tool-specific formatting means users see relevant context immediately (e.g., the actual shell command, not just `{"cmd": "..."}`
- Vim key support enables power users to navigate without moving hands from home row

### Developer Experience

- Panel renderer is fully reusable — future CLI features can render bordered boxes with consistent styling
- Tool formatter is easily extensible — add one line to the map to support a new tool type
- Bubbletea patterns established — creates foundation for T04 (progress indicators) and T05 (polish)

### Code Quality

- Single Responsibility Principle enforced: panel rendering, formatting, and prompt logic in separate focused files
- All new files under 200 lines (smallest: 146 lines, largest: 186 lines)
- Domain-agnostic code in `pkg/`, Stigmer-specific logic in `cmd/`
- Net -99 lines across modified files (cleaned up while adding features)

### Architecture

- Establishes lipgloss as the standard for static styled text rendering
- Establishes Bubbletea as the standard for interactive CLI components
- Creates patterns that T04 and T05 implementations will follow

## Files Changed

### New Files (7)

| File | Lines | Purpose |
|------|-------|---------|
| `pkg/panel/panel.go` | 146 | Lipgloss box-panel renderer |
| `pkg/panel/panel_test.go` | 177 | Panel rendering tests (15 tests) |
| `pkg/panel/BUILD.bazel` | 17 | Bazel build config |
| `pkg/approval/formatter.go` | 153 | Tool-type-aware arg formatter |
| `pkg/approval/formatter_test.go` | 271 | Formatter tests (26 tests) |
| `pkg/approval/prompt_model.go` | 186 | Bubbletea selection model |
| `pkg/approval/prompt_model_test.go` | 272 | Prompt model tests (22 tests) |

### Modified Files (6)

| File | Change |
|------|--------|
| `pkg/approval/interactive.go` | Replaced Survey with Bubbletea (65 → 65 lines) |
| `pkg/approval/interactive_test.go` | Removed indexToAction tests (function removed) |
| `pkg/approval/BUILD.bazel` | Survey deps → charmbracelet deps |
| `cmd/stigmer/root/run_display_approval.go` | Panel-based rendering (91 → 80 lines) |
| `cmd/stigmer/root/run_display_approval_test.go` | Updated for panel format (371 → 264 lines) |
| `cmd/stigmer/root/BUILD.bazel` | Added panel dep, test helper |

### Test Coverage

- **Panel package**: 15 tests, 100% pass
- **Approval package**: 62 tests total (26 formatter + 14 existing + 22 prompt model), 100% pass
- **Root package (approval tests)**: 51 tests, 100% pass
- **Zero regressions**: All pre-existing tests continue passing

## Related Work

This completes T03 (Rich Approval Experience) from the Interactive CLI Experience project (`20260214.01`):

- **T02 (Streaming-First Engine)**: Completed — streaming infrastructure that T03 integrates with
- **T04 (Live Progress & Structured Tool Display)**: Next — will build on panel renderer and Bubbletea patterns
- **T05 (Polish & Edge Cases)**: Future — will unify styling and add execution summaries

The panel renderer and formatter are designed as reusable primitives that T04 and T05 will leverage.

---

**Status**: ✅ Production Ready  
**Timeline**: 1 development session (February 14, 2026)  
**Project**: `_projects/2026-02/20260214.01.interactive-cli-experience`  
**Plan**: `.cursor/plans/t03_rich_approval_experience_ecdae5b2.plan.md`
