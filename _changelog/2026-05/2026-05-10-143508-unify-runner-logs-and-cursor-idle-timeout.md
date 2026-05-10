# Unify Runner Logs and Implement Cursor-Runner Idle Timeout

**Date**: May 10, 2026

## Summary

Unified agent-runner and cursor-runner log output into a single interleaved file with `[agent]`/`[cursor]` component prefixes, and implemented the cursor-runner's idle timeout watchdog so orphaned processes self-terminate instead of spinning at 100% CPU indefinitely.

## Problem Statement

The runner system runs two child processes (Python agent-runner, TypeScript cursor-runner) but each wrote to a separate log file. The Desktop UI only showed the agent-runner's log, making the cursor-runner invisible to users. Additionally, the cursor-runner had a parsed but unimplemented `STIGMER_IDLE_TIMEOUT_SECONDS` config, leaving orphaned processes with no self-termination mechanism.

### Pain Points

- Desktop log viewer showed only Python agent-runner output; cursor-runner logs were in a hidden `-cursor.log` file
- The `RunnerState.LogFile` field pointed only to the agent-runner log; the Desktop's file-tail fallback never reached cursor-runner output
- Orphaned cursor-runner processes consumed 98%+ CPU spinning on Temporal SDK reconnection with no idle timeout to bound the damage
- The `idleTimeoutSeconds` config was parsed from `STIGMER_IDLE_TIMEOUT_SECONDS` but never wired to any shutdown mechanism

## Solution

Two complementary changes: unified logging at the Go CLI layer, and an idle watchdog at the TypeScript cursor-runner layer.

## Implementation Details

### Unified Log with Component Prefixes (Go CLI)

Added a `prefixWriter` type that prepends `[agent] ` or `[cursor] ` at the start of each new line written to the underlying writer. Both `startPythonProcess` and `launchCursorRunnerProcess` now share a single `cappedWriter` backed by one log file. The separate `-cursor.log` file is no longer created.

The Go parent also writes a `[cursor] Cursor runner ready (PID N), polling on <queue>:cursor` confirmation line to the shared log when the cursor-runner starts, providing a clear signal the cursor-runner is alive.

### Idle Timeout Watchdog (TypeScript cursor-runner)

New `idle-watchdog.ts` module with three exports:
- `activityStarted()` / `activityFinished()` — called as a wrapper around the `ExecuteCursor` activity in `createActivities()`
- `startIdleWatchdog(worker, timeoutSeconds)` — runs a `setInterval` that checks time since last activity; calls `worker.shutdown()` after sustained idle

Wired in `main.ts`: the watchdog activates only when `config.idleTimeoutSeconds` is set and positive (cloud sandboxes via Daytona). Local runners do not set the env var, so the watchdog is inactive for `stigmer up` sessions.

## Benefits

- Desktop log viewer now shows both agent-runner and cursor-runner output in a single unified stream
- Component prefixes (`[agent]`/`[cursor]`) make it easy to filter or distinguish the source
- Orphaned cursor-runner processes self-terminate after the idle timeout instead of spinning indefinitely
- On-disk log files are a single unified timeline instead of two separate files

## Impact

- **CLI runner package** (`start.go`): Unified log writer, prefixWriter type, refactored function signatures
- **cursor-runner** (`main.ts`, `execute-cursor.ts`, new `idle-watchdog.ts`): Activity tracking + idle watchdog
- **Desktop app**: Benefits transitively — no Desktop code changes needed

## Related Work

- Follows `fix(cli/runner): prevent orphaned agent-runner and cursor-runner processes` (SIGHUP + orphan detection)
- Part of `20260509.02.runner-management-ux-overhaul` project

---

**Status**: Production Ready
**Timeline**: 1 session
