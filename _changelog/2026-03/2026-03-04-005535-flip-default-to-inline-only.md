# Flip CLI Default to Inline-Only Output

**Date**: March 4, 2026

## Summary

The Stigmer CLI now defaults to inline terminal output for all contexts, removing the alt-screen TUI as the default interactive mode. The `--no-tui` flag has been removed since inline is the only non-JSON output mode. TUI code is retained in the codebase for potential future use.

## Problem Statement

The CLI defaulted to an alt-screen Bubbletea TUI when stdout was a TTY. This introduced terminal corruption risks, broke scrollback history, and created a more complex mental model for users. The inline renderer (added in Phase 2.2 of cli-tui-ux-hardening) proved to be a fundamentally better default.

### Pain Points

- Alt-screen TUI erased scrollback after completion, losing context
- Terminal corruption bugs required an emergency restore mechanism (`stigmer fix`)
- `--no-tui` flag was needed to get the simpler inline experience
- Five-branch `resolveOutputMode` logic (JSON, NoTUI, non-TTY, TERM=dumb, default) was more complex than necessary

## Solution

Simplified the output mode to a two-path decision: `--json` for machine-readable output, inline for everything else. Removed the `--no-tui` flag and all terminal environment detection branches that only existed to route between TUI and inline.

## Implementation Details

Four files changed in `client-apps/cli/cmd/stigmer/root/`:

- **`output_mode.go`**: Removed `NoTUI` from `outputModeFlags`, removed `--no-tui` flag registration and mutual exclusivity rule, simplified `resolveOutputMode` from five branches to two. Removed `os` and `display` package imports that were only needed for TTY/TERM detection. Retained `OutputInteractive` constant for TUI code that still references it.
- **`output_mode_test.go`**: Removed six tests covering `NoTUI` flag, TERM=dumb, and environment detection. Added `TestResolveOutputMode_NoFlags_AlwaysInline` to assert the new invariant.
- **`run.go`**: Removed `--no-tui` from help text and examples. Updated output mode description to reflect inline-first default.
- **`doctor_checks_runtime.go`**: Updated non-interactive environment hint to suggest only `--json`.

## Benefits

- Simpler mental model: output is inline unless you ask for JSON
- No terminal corruption risk from alt-screen in default path
- Scrollback preserved after every run
- `resolveOutputMode` reduced from 15 lines with 5 branches to 6 lines with 1 branch
- Removed dependency on `pkg/display` and `os` in output mode logic

## Impact

- **Users**: Default `stigmer run` experience changes from alt-screen TUI to inline. Users who relied on `--no-tui` can simply remove the flag.
- **Scripts**: No impact. `--json` is unchanged. Scripts using `--no-tui` will get an "unknown flag" error (acceptable for pre-1.0).
- **Codebase**: TUI code is retained but unreachable from CLI flags. Dead code in `run_stream.go` and `run_session.go` default branches is intentionally preserved.

## Related Work

- Builds on Phase 2.2 (Two-Lane Output) from cli-tui-ux-hardening project
- Foundation for Phase 2 (Compact Tool Rendering) of inline-first-cli project
- Precedes OSC 8 clickable file paths, compact read/write/shell rendering, and sub-agent grouping

---

**Status**: Production Ready
**Timeline**: Phase 1 of inline-first-cli project
