# cliprint Sunset: Migrate Legacy Print Functions to climsg

**Date**: February 26, 2026

## Summary

Sunset the legacy `cliprint.Print{Info,Error,Warning,Success}` functions by creating a new `climsg` package for ephemeral CLI messages and migrating all 27 call sites across 51 files. The `cliprint` package is now reduced to only its `ProgressDisplay` (BubbleTea) component, with all status/diagnostic output routed through `climsg` to stderr.

## Problem Statement

The `cliprint` package mixed two fundamentally different concerns: ephemeral status messages (info, error, warning, success) and interactive TUI progress displays (BubbleTea spinners). Both wrote to stdout, which corrupted machine-readable output when `--json` or pipe redirection was used.

### Pain Points

- `cliprint.PrintInfo` wrote colored status text to stdout, interleaving with structured command output
- No separation between ephemeral diagnostic messages and primary command results
- 27 files imported `cliprint` — many only needed the simple print functions, not the BubbleTea machinery
- Tests relied on capturing stdout to verify status messages, creating fragile test infrastructure
- The `fatih/color` dependency in `cliprint` was only needed by the print functions, not by `ProgressDisplay`

## Solution

Created a clean-layered replacement:

1. **New `climsg` package** (`client-apps/cli/pkg/climsg/`) — lightweight ephemeral messaging to stderr with colored icon-prefixed output
2. **Mechanical migration** of all `cliprint.Print*` call sites to either `climsg.*` (for status messages) or `fmt.Printf` (for display/table output)
3. **Shrink `cliprint`** — deleted `cliprint.go`, leaving only `progress.go` with the BubbleTea `ProgressDisplay`

## Implementation Details

### climsg Package Design

Dual-layer API following Go's `slog` pattern:
- **`Writer` struct**: Injectable `io.Writer`, enables testing without global state mutation
- **Package-level functions**: `climsg.Info()`, `climsg.Success()`, `climsg.Warning()`, `climsg.Error()` — thin wrappers over an internal `Writer` initialized with `os.Stderr`
- **`ReplaceOutput(w io.Writer) func()`**: Test helper to temporarily swap the internal writer, returning a restore function

### Migration Categories

| Category | Files | Strategy |
|----------|-------|----------|
| `display.go` files | 8 | `cliprint.PrintInfo` → `fmt.Printf` (drop decorative cyan) |
| `cmd/stigmer/root/` | 19 | `cliprint.Print*` → `climsg.*` (preserve semantics, redirect to stderr) |
| `internal/cli/` packages | 8 | Mixed — appliers to `climsg`, display to `fmt.Printf` |

### Test Infrastructure Fix

The `captureColorOutput` helper in `run_approval_test.go` captured stdout + `color.Output`. After migration, `climsg` output went to stderr via its internal writer. Added `climsg.ReplaceOutput()` to redirect the internal writer into the test capture pipe, restoring it via deferred cleanup.

### BUILD.bazel Updates

- Added `//client-apps/cli/pkg/climsg` dependency to 12 packages
- Removed `//client-apps/cli/internal/cli/cliprint` from 3 packages that no longer import it
- Removed `fatih/color` from `cliprint/BUILD.bazel` (no longer needed after `cliprint.go` deletion)

## Benefits

- **Clean stdout/stderr separation**: All ephemeral messages now go to stderr; stdout is reserved for structured data
- **Smaller dependency surface**: Files needing only status messages no longer pull in BubbleTea/lipgloss
- **Testable by design**: `climsg.Writer` accepts any `io.Writer`; `ReplaceOutput` enables clean test isolation
- **Net code reduction**: 51 files changed, -59 lines net (removed more than added)
- **`cliprint` minimized**: Package reduced from 2 source files + `fatih/color` dependency to 1 source file (`progress.go`) + only BubbleTea dependencies

## Impact

- **CLI users**: No visible behavior change — same icons, same colors, but status messages now correctly route to stderr
- **Scripting/piping**: `stigmer list 2>/dev/null` now cleanly separates data from diagnostics
- **Maintainers**: Clear package boundaries — `climsg` for messages, `clioutput` for structured results, `cliprint` only for interactive TUI
- **Future work**: Table rendering modernization (Item 4) and ProgressDisplay migration can proceed independently

## Related Work

- Part of the CLI Output System Refactor project (`20260226.01.cli-output-system-refactor`)
- Builds on Phase 5 (cleanup/polish) which wired `--json`/`--quiet` flags
- Prerequisite for future table rendering modernization (deferred Item 4)
- `cliprint.ProgressDisplay` migration deferred to separate project (BubbleTea paradigm)

---

**Status**: ✅ Production Ready
**Timeline**: Single session — design, implementation, testing, and verification
