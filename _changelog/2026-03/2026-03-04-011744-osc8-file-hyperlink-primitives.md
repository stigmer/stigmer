# OSC 8 File Hyperlink Primitives for Inline Tool Rendering

**Date**: March 4, 2026

## Summary

Added OSC 8 terminal hyperlink primitives to `pkg/toolrender/` — a pure formatting function, file URI constructor, and terminal capability detector. This is the foundational building block that enables clickable file paths in the upcoming compact tool rendering (Phases 2.1-2.5), where every file path rendered by the inline CLI will be a one-click link to open the file.

## Problem Statement

The inline renderer displays file paths as plain text in tool call output (e.g., "Read: path/to/file.go"). Users who want to inspect a file the agent touched must manually copy the path and open it in their editor. As we move toward compact rendering (fewer content previews, more metadata-only displays), clickable paths become essential — they compensate for not showing file content inline by making the content one click away.

### Pain Points

- File paths in tool output are not interactive — users must copy/paste to open files
- Compact rendering (planned) will show less content inline, making quick file access more important
- No existing OSC 8 hyperlink infrastructure in the codebase
- No centralized terminal capability detection for escape sequence support

## Solution

Created a self-contained hyperlink module in `pkg/toolrender/hyperlink.go` with three exported functions following dependency injection principles:

- **`Hyperlink(displayText, uri)`** — Generic OSC 8 wrapper for any URI scheme
- **`FileHyperlink(displayPath, absolutePath, enabled)`** — File-specific wrapper with graceful degradation
- **`HyperlinksEnabled(w)`** — Terminal capability detection (TTY, TERM=dumb, NO_COLOR)

## Implementation Details

The design follows two key principles: **pure formatting** and **caller-controlled degradation**.

`FileHyperlink` accepts an explicit `enabled bool` rather than auto-detecting terminal capabilities. This satisfies the DI coding guideline ("functions MUST accept dependencies as parameters") and ensures the env var check happens once per renderer lifecycle rather than per tool call. The inline renderer will call `HyperlinksEnabled(cfg.status)` at initialization and thread the boolean through all rendering calls.

File URIs are constructed via Go's `net/url.URL` for correct percent-encoding of spaces, unicode characters, and URI-significant characters (`#`, `%`, `?`). The OSC 8 escape sequence uses ESC+backslash as the String Terminator per the modern spec.

Detection is conservative: `NO_COLOR` disables hyperlinks even though the spec technically targets color codes only, because users who set `NO_COLOR` expect clean text without escape sequences.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `pkg/toolrender/hyperlink.go` | 81 | Core hyperlink functions and OSC 8 constants |
| `pkg/toolrender/hyperlink_test.go` | 257 | 22 test functions covering all paths |
| `pkg/toolrender/BUILD.bazel` | +3 | Added sources and `golang.org/x/term` dep |

## Benefits

- **One-click file access**: When integrated (Phase 2.1+), every file path in tool output will be clickable in iTerm2, Wezterm, Kitty, Ghostty, Hyper, and GNOME Terminal
- **Graceful degradation**: Unsupported terminals see plain text — no garbled output
- **Pure and testable**: No global state, no env var reads in formatting functions, full test coverage
- **Future-proof**: Generic `Hyperlink` function supports non-file URIs (HTTP links, issue tracker URLs)

## Impact

- **Developers using Stigmer CLI**: Will be able to click file paths in tool output starting in Phase 2.1
- **Codebase**: Adds a clean, well-tested primitive with zero changes to existing code
- **Architecture**: Establishes the pattern for terminal capability detection in the toolrender package

## Related Work

- Phase 1: Flip default to inline mode (completed)
- Phase 2.1: Read tool compact rendering (next — will integrate hyperlinks)
- Phase 2.2-2.5: Remaining compact tool rendering surfaces

---

**Status**: ✅ Production Ready
**Timeline**: Phase 2.0 of inline-first CLI project
