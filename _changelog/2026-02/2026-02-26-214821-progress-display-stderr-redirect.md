# ProgressDisplay Output Redirect to stderr

**Date**: February 26, 2026

## Summary

Redirected all BubbleTea ProgressDisplay output and decorative blank-line writes from stdout to stderr, enforcing the CLI output contract that reserves stdout exclusively for structured data (CommandResult JSON, piped values) while ephemeral status (spinners, progress, diagnostics) flows through stderr.

## Problem Statement

`ProgressDisplay` — the BubbleTea-based interactive spinner used by `server start`, `server llm pull`, and `EnsureRunning` (auto-start) — was writing to stdout via the default `tea.NewProgram(model)` output. Additionally, four bare `fmt.Println` calls in command handlers leaked decorative blank lines to stdout.

### Pain Points

- Scripts piping `stigmer server` or `stigmer server llm pull` stdout would capture spinner escape sequences alongside any structured output
- The `--json` flag infrastructure (added in the cli-output-system-refactor project) could not guarantee clean JSON on stdout when ProgressDisplay was active
- `EnsureRunning` (called transparently by `apply`, `delete`, etc.) would contaminate stdout even for commands that already support `--json`/`--quiet`

## Solution

Single-point fix at the `NewProgressDisplay` constructor plus targeted `fmt.Fprintln(os.Stderr)` replacements for the four bare blank-line writes.

## Implementation Details

**`cliprint/progress.go`**: Added `tea.WithOutput(os.Stderr)` to `tea.NewProgram`. This is the root fix — all three call sites and all downstream consumers (7 `SetPhase` calls in `daemon.StartWithOptions`, 3 in `llm.SetupOptions`) inherit the correction with zero API changes.

**`server_llm.go`**: Two `fmt.Println("")` calls in `handleLLMPull` changed to `fmt.Fprintln(os.Stderr)`.

**`daemon.go`**: Two `fmt.Println()` calls in `EnsureRunning` changed to `fmt.Fprintln(os.Stderr)`.

No import additions needed in the handler files (`fmt` and `os` already imported). The `cliprint` package gained an `"os"` import. No BUILD.bazel changes needed (`os` is stdlib).

## Benefits

- **Clean stdout guarantee**: `stigmer server 2>/dev/null` now produces zero output; scripts piping stdout get only structured data
- **Retroactive fix for existing commands**: `stigmer apply --json` stdout is now clean even when `EnsureRunning` fires (auto-start progress goes to stderr)
- **Zero visual regression**: Interactive users see identical spinner behavior (stderr is a TTY in normal terminal use)
- **Foundation for Steps 3-4**: `--json`/`--quiet` flag support for `server start` and `server llm pull` can now build on a correct output stream separation

## Impact

- **3 files changed**, 5 lines modified (1 constructor + 4 blank-line writes)
- **All 3 ProgressDisplay call sites** corrected via single constructor change
- **All downstream phase updates** (10 total across daemon and LLM packages) inherit correction
- **No API changes** to ProgressDisplay lifecycle (`Start`/`Stop`/`SetPhase`/`CompletePhase`)

## Related Work

- [CLI Output System Foundation](2026-02-26-025243-cli-output-system-foundation.md) — established the stdout/stderr contract
- [cliprint Sunset & climsg Migration](2026-02-26-194607-cliprint-sunset-climsg-migration.md) — migrated print functions to stderr-based `climsg`
- [Output Format Integration Tests](2026-02-26-210031-output-format-integration-tests.md) — test coverage for `--json`/`--quiet` flags

---

**Status**: ✅ Production Ready
**Timeline**: Part of project 20260226.03 (progress-display-output-correctness), Steps 1-2 of 6
