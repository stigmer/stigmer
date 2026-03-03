# Comprehensive Error Handler for CLI

**Date**: March 3, 2026

## Summary

Redesigned the `clierr` package to provide structured error classification, differentiated exit codes, comprehensive gRPC code coverage, and `--debug` error chain output. Also discovered and fixed a pre-existing bug where wrapped gRPC errors were silently misclassified across 25+ command error sites.

## Problem Statement

The CLI's error handler (`clierr.Handle`) was minimal — it only recognized 4 gRPC codes (Unavailable, NotFound, InvalidArgument, Unauthenticated), always exited with code 1, and could not show diagnostic details. Errors like PermissionDenied, DeadlineExceeded, ResourceExhausted, and Internal dumped raw gRPC messages with no actionable guidance.

### Pain Points

- Only 4 of 13+ possible gRPC codes were handled with user-friendly messages
- Exit code was always 1 regardless of error category — scripts and CI pipelines could not distinguish between auth failures, connection issues, and usage errors
- No way to see the raw error chain for debugging — users had to guess what went wrong
- A silent bug: `status.FromError()` only checks the outermost error, but commands wrap gRPC errors with `errors.Wrap()`. Wrapped gRPC errors fell through to the generic "Error: ..." handler, bypassing all the helpful messaging

## Solution

Separated error handling into three independently testable concerns: **classification** (`Classify`), **formatting** (`formatError`), and **exit** (`Handle`). Introduced a `CLIError` type that carries exit code, user message, hints, and the original error. Added `extractGRPCStatus` to walk the error unwrap chain, fixing the wrapped-error misclassification bug.

## Implementation Details

- **`CLIError` type**: Structured error with `ExitCode`, `Message`, `Hints []string`, and `Cause error`. Implements `Error()` and `Unwrap()`.
- **`Classify(err) *CLIError`**: Pure function with no side effects. Calls `extractGRPCStatus` to find gRPC status through wrapped errors, then maps via `classifyGRPCCode`.
- **`extractGRPCStatus(err)`**: Walks the `errors.Unwrap()` chain looking for an error implementing `GRPCStatus()`. Fixes the pre-existing bug where `status.FromError()` missed wrapped gRPC errors.
- **`classifyGRPCCode(st)`**: Switch over 13 gRPC codes with tailored messages and exit codes.
- **Exit code constants** in `exit_codes.go`: `ExitSuccess=0`, `ExitGeneral=1`, `ExitUsage=2`, `ExitConnection=3`, `ExitAuth=4`, `ExitNotFound=5`.
- **`--debug` extension**: `SetDebug(bool)` wired from `PersistentPreRun`. When enabled, `formatError` appends a `--- debug ---` section with gRPC code and raw error string.
- **`main.go`**: Cobra-level errors now route through `clierr.Handle` instead of raw `fmt.Fprintf + os.Exit(1)`.

## Benefits

- **13 gRPC codes handled** (up from 4) with actionable messages and fix suggestions
- **6 differentiated exit codes** — scripts and CI can now programmatically distinguish error categories via `$?`
- **Wrapped error correctness** — gRPC errors wrapped with `errors.Wrap()` at 25+ call sites now correctly classified instead of falling through to the generic handler
- **Debug diagnostics** — `stigmer --debug <command>` shows gRPC code and raw error chain alongside the user-friendly message
- **Fully testable** — `Classify` and `formatError` are pure functions; 24 tests cover all codes, wrapping depths, and formatting modes without `os.Exit` mocking

## Impact

- All CLI commands benefit automatically — no changes needed in individual command handlers
- Scripts wrapping `stigmer` commands can now use exit codes to implement conditional logic (e.g., retry on exit 3/connection, re-auth on exit 4)
- Users with `--debug` can self-diagnose issues before filing bug reports
- The wrapped-error fix means users will now see "Cannot connect to stigmer-server" instead of `Error: failed to connect to backend: rpc error: code = Unavailable desc = ...`

## Related Work

- Phase 1.3 introduced `classifyStreamError` for stream-layer errors (TUI mid-operation display) — a separate concern from command-level error classification
- Phase 2.5 (`stigmer doctor`) will build on the exit code constants for diagnostic checks
- Phase 3.1 (stdout/stderr separation) will complement this by ensuring all error output goes to stderr

---

**Status**: Production Ready
**Timeline**: Phase 2.1 of CLI/TUI UX Hardening project
