# Multi-Runner Management (T05)

**Date**: April 22, 2026

## Summary

Hardened the multi-runner infrastructure with proactive stale state cleanup, slug validation, rich conflict errors, local runner listing via `stigmer list runners`, and a fix to `stigmer down` so it stops both the server daemon and standalone runners as its help text promises.

## Problem Statement

T04 delivered the core runner lifecycle (`stigmer up` / `stigmer down runner`), but the multi-runner experience had rough edges that would trip users up the moment they ran more than one runner or had a runner crash.

### Pain Points

- Crashed runners left stale state files in `~/.stigmer/runners/`, blocking name reuse and polluting stop-all flows.
- Name conflict errors were bare (`"runner %q is already running"`) with no context or guidance.
- No validation on `--name` values — uppercase, dots, spaces, or 200-character names would pass through to the server slug and filesystem, causing silent failures.
- No way to see which runners are active on this machine (`stigmer list runners` didn't exist).
- `stigmer down` promised "and any standalone runners" in its help text but only stopped the daemon.

## Solution

Five targeted changes to the CLI runner package and command layer, each addressing one gap.

## Implementation Details

### Stale State Reaping (`state.go`)

Added `ReapStaleRunners()` that scans `~/.stigmer/runners/`, probes each PID, and removes files for dead processes. Called proactively at the start of `Start()` (before name resolution) so stale names don't block reuse. `ListActiveRunners()` and the new `ListAllRunnerStates()` also reap while iterating, replacing the passive filter-only approach.

Extracted a shared `loadAllStates()` helper that reads all `.json` files, skipping corrupt entries, and returns a `map[string]*RunnerState`. This eliminated duplication across the three listing/reaping functions.

### Rich Name Conflict Error (`start.go`)

Replaced the single-line error with a multi-line message that loads the existing runner's state and shows PID, backend endpoint, start time (relative — "2 hours ago"), and actionable guidance for both starting another runner and listing active runners.

### Slug Validation (`start.go`)

Runner names are used as filesystem keys, server-side slugs, and metadata names simultaneously. Added:
- `validateSlug()` for explicit `--name` values: lowercase alphanumeric + hyphens, no leading/trailing hyphens, max 63 characters. Rejects invalid input with clear guidance.
- `sanitizeToSlug()` for hostname defaults: lowercases, replaces dots/underscores/spaces with hyphens, collapses runs, trims edges. Logs a user-visible message when sanitization changes the name.

### Local Runner Listing (`list.go`, `registry.go`, `verb_support.go`)

- Added `ApiResourceKind_runner` to `cliRelevantKinds` in the type registry.
- Added runner verb support: apply, get, list (list marked as local-only in the verb matrix comment).
- Added `isRunnerType()` routing and `executeListRunners()` in the list command.
- Table output uses the existing `display.Table` with adaptive terminal width, showing NAME, PID, BACKEND, TASK QUEUE, and STARTED columns with sorted names.

### `stigmer down` Fix (`down.go`)

Split `handleStop` into `handleStop` (daemon + runners) and `handleStopServer` (daemon only). `stigmer down` calls both; `stigmer down server` calls server-only; `stigmer down runner` is unchanged.

## Benefits

- Crashed runners no longer leave orphaned state — names are automatically freed on next `stigmer up` or `stigmer list runners`.
- Users get actionable context when a name conflict occurs, reducing confusion in multi-runner setups.
- Invalid names fail fast at the CLI layer instead of propagating to the server or filesystem.
- `stigmer list runners` gives users visibility into what's running on their machine without needing to check process tables.
- `stigmer down` actually does what it says — stops everything.

## Impact

- **CLI users**: Better multi-runner UX across all three lifecycle commands (up, down, list).
- **Runner package**: Three new public functions (`ReapStaleRunners`, `ListAllRunnerStates`, `sanitizeToSlug`) available for future use.
- **Type registry**: Runner is now a first-class CLI-visible resource kind.

## Related Work

- T04 (Runner Lifecycle) — the foundation this hardens
- T06 (Embedded Runner Identity) — next task, depends on T05
- 20260422.02 (Runner Command Stream) — Go supervisor model, forward-compatible with T05 state format

---

**Status**: Production Ready
**Timeline**: 1 session
