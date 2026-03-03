# Terminal Cursor Control Primitives (pkg/termctl)

**Date**: March 4, 2026

## Summary

Created a new `pkg/termctl/` package providing low-level ANSI cursor control primitives for the Stigmer CLI inline renderer. This is the foundation for Phase 3's approval-collapse UX — erasing expanded tool content and replacing it with a compact summary after the user makes an approval decision.

## Problem Statement

The inline renderer (Phase 2) renders tool calls as compact one-liners in normal terminal scrollback. Phase 3 introduces a Claude Code-style approval flow where tools requiring approval show expanded content (streaming file contents, command preview) during the decision phase, then cursor-collapse to a compact summary after the user approves/rejects/skips.

### Pain Points

- No ANSI cursor control primitives exist in the codebase for moving the cursor up and erasing previously written lines
- Existing terminal utilities (`display/terminal.go`) are hardcoded to `os.Stdout` — the inline renderer writes status to `os.Stderr`
- Display row calculation (accounting for line wrapping and ANSI escape sequences) is needed for accurate cursor positioning but doesn't exist
- Scattered terminal detection patterns across packages (`display.IsTerminal`, `spinner.isWriterTerminal`, `toolrender.HyperlinksEnabled`) with no unified cursor-control-specific capability check

## Solution

New package `client-apps/cli/pkg/termctl/` with 7 stateless, DI-compliant public functions — all accepting `io.Writer` parameters with no hardcoded file descriptors.

## Implementation Details

**Public API:**

| Function | Purpose |
|----------|---------|
| `IsSupported(w)` | TTY + not-dumb check (NO_COLOR excluded — cursor control is UX, not color) |
| `MoveUp(w, n)` | ANSI CSI CUU — move cursor up n lines (no-op for n<=0) |
| `ClearDown(w)` | ANSI CSI ED — erase cursor to end of screen |
| `ClearLine(w)` | ANSI CSI EL — erase entire line + carriage return |
| `EraseLines(w, n)` | Atomic MoveUp + ClearDown in single Write call |
| `Width(w, default)` | Terminal width via fd with fallback |
| `DisplayRows(text, width)` | Row count with ANSI-aware wrapping via `charmbracelet/x/ansi` |

**Key design choices:**

- `IsSupported` does NOT check `NO_COLOR` — cursor control (collapsing content after approval) is a UX mechanism, not color decoration
- `EraseLines` writes the full ANSI sequence atomically (single `Write` call) to prevent interleaving with concurrent output
- `MoveUp(w, 0)` is a guarded no-op because the ANSI spec treats parameter 0 as 1
- `DisplayRows` delegates to `charmbracelet/x/ansi.StringWidth` (already a dependency) for correct handling of CSI, OSC 8 hyperlinks, and Unicode

**Test coverage:** 37 test functions covering ANSI output verification, no-op guards, atomic write validation, DisplayRows with wrapping/trailing newlines/ANSI sequences/edge cases, and fallback behavior.

## Benefits

- Clean foundation for Phase 3.1-3.4 (approval prompter, content streaming, cursor-collapse, shell approval)
- DI-compliant — no `os.Stdout` hardcoding, testable with `bytes.Buffer`
- Atomic `EraseLines` prevents visual corruption from interleaved writes
- `DisplayRows` accurately counts terminal rows including line wrapping and ANSI escape sequences — critical for pixel-perfect cursor positioning in the collapse flow

## Impact

- **CLI team**: New reusable package available for any future terminal cursor control needs
- **End users**: No direct user impact yet — this is infrastructure for the Phase 3 approval UX
- **Codebase**: Additive only — zero changes to existing packages

## Related Work

- Follows Phase 2.5 (sub-agent tool grouping) which completed the compact rendering layer
- Prerequisite for Phase 3.1 (custom inline prompter with raw terminal mode)
- `DisplayRows` will be used by Phase 3.3 (`handleApproval` rewrite) for line counting during collapse

---

**Status**: Production Ready
**Timeline**: 1 session
