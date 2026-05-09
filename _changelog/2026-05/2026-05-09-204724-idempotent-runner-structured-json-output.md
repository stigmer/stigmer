# Idempotent Runner with Structured JSON Output

**Date**: May 9, 2026

## Summary

Added a structured JSON output contract to `stigmer up [runner] --json` and extracted an `Ensure()` function with an `onReady` callback pattern, enabling the Desktop sidecar to consume typed machine-readable output instead of parsing stderr text. Also extended `stigmer status` to show standalone runners.

## Problem Statement

After T01 made "already running" a success case, the CLI printed human-readable messages on stderr but had no machine-consumable output. The Desktop sidecar relied on exit-code-only detection to distinguish adoption from errors, with no structured data about the adopted runner.

### Pain Points

- Desktop had no typed contract for runner state after start/adopt — it inferred state from `list_local_runners` calls
- CLI's `--json` flag on `stigmer up` was declared but unused
- `stigmer status` showed only daemon health, not standalone runners — no way to check runner state without reading `~/.stigmer/runners/*.json` manually
- The `Start()` function was a monolith mixing orchestration, output, and process lifecycle

## Solution

Introduced a callback-based `Ensure()` function that invokes `onReady` as soon as the runner is live (immediately for adoption, after SaveState + READY for fresh starts), then continues blocking for the process lifecycle. `Start()` becomes a thin wrapper. The `--json` flag on `stigmer up` writes a typed `EnsureResult` to stdout.

## Implementation Details

**New file: `ensure.go`** — Defines `EnsureResult`, `EnsureAction`, `EnsureError` types and the `Ensure()` function with `onReady func(*EnsureResult)` callback. The callback model lets the command handler write JSON to stdout during the sidecar's 8-second grace window, before the blocking process wait.

**Refactored: `start.go`** — `Start()` is now a one-liner: `return Ensure(ctx, opts, func(r) { PrintHumanResult(r) })`. Both `startNativeRunner` and `startDockerRunner` accept the callback and invoke it after SaveState + phase=READY.

**Wired: `up.go`** — `handleUpRunner` now accepts `clioutput.OutputFormat`. JSON mode calls `Ensure()` directly; human mode calls `Start()` as before.

**Extended: `status_cmd.go`** — New `addStandaloneRunnerSection` enumerates `~/.stigmer/runners/*.json`, sorted alphabetically, showing PID, backend, uptime, and Docker tag.

**Updated: `sidecar.rs`** — Added `--json` to sidecar CLI args. Added `CliEnsureResult`/`CliEnsureError` deserialization types and `try_parse_ensure_output` parser. Adoption path parses structured JSON from stdout with graceful fallback.

## Benefits

- **Typed machine contract**: Desktop gets `{"ok": true, "action": "adopted_existing", "runner_id": "...", ...}` instead of inferring from side effects
- **Verb-first CLI preserved**: No new `stigmer runner` command group — respects the existing CLI design language
- **Standalone runner visibility**: `stigmer status` now shows all active runners, not just daemon-managed components
- **Clean decomposition**: `Ensure()` with callback is independently testable and reusable by future callers

## Impact

- **CLI users**: `stigmer up --json` now returns structured output; `stigmer status` shows standalone runners
- **Desktop sidecar**: Consumes typed JSON in adoption path; graceful fallback means existing behavior preserved if JSON parsing fails
- **Codebase**: 540 lines added across 7 files (2 new, 5 modified); 13 new tests; all 36 runner tests pass

## Related Work

- T01: `feat(runner): treat already-running as success instead of error` (commit `4db26fe36`)
- Runner Management UX Overhaul project: Phase 1 of 6
- Next: T03 (stable machine_id identity), T04 (local control socket), T05 (Desktop UI redesign)

---

**Status**: ✅ Production Ready
**Commit**: `c7a70977e`
