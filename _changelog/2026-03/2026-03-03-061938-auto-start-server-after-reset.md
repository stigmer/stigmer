# Auto-Start Server After Reset

**Date**: March 3, 2026

## Summary

`stigmer server reset` now automatically restarts the server after cleaning up runtime data, giving the same full interactive startup experience as `stigmer server`. This eliminates the manual "run `stigmer server` to start fresh" step and ensures consistent UX across both commands.

## Problem Statement

After running `stigmer server reset`, the CLI printed a message telling the user to manually run `stigmer server` to start fresh. In practice, this step was redundant — the very next stigmer command would trigger `daemon.EnsureRunning()`, which auto-starts the daemon with a much simpler, inconsistent UX (no phased progress, no LLM status, no MCP discovery, no "Ready!" output).

### Pain Points

- Extra manual step after every reset that added no value
- If user skipped the manual step, the next command auto-started with a lighter UX — no phased progress, no MCP discovery, no server status
- Inconsistent experience between `stigmer server` (full startup) and post-reset auto-start (minimal)
- Slows down the reset-and-iterate development loop

## Solution

Extracted the full interactive server startup logic from `handleServerStart` into a shared `startServerFresh` function, then called it from both `stigmer server` and `stigmer server reset` (when config is preserved). When `--include-config` is used, the manual message is retained since the setup wizard must run.

## Implementation Details

**Extracted `startServerFresh` in `server.go`**: Shared function that handles the complete interactive startup flow — config/secret loading, phased progress display (Initializing → Installing → Starting), gRPC readiness check, degraded component reporting, LLM status, seedpack bootstrap, org context auto-detection, MCP discovery, and "Ready!" status output with PID/Port/Data/WebUI.

**Refactored `handleServerStart`**: Now delegates to `startServerFresh` after its preamble (config wizard, stop existing server), passing through cobra execution-mode/sandbox flags via `StartOptions`.

**Updated `server_reset.go`**: After successful reset (config preserved), calls `startServerFresh(dataDir, daemon.StartOptions{}, clioutput.FormatHuman)` — same full startup experience, default options.

**`--include-config` path unchanged**: When config is also removed, the user still sees the "Run 'stigmer server' to reconfigure" message since the setup wizard needs to run.

## Benefits

- One fewer manual step in the reset workflow
- Consistent UX: reset gives the same polished startup experience as `stigmer server`
- Server is fully ready (gRPC, seedpack, org context, MCP) immediately after reset
- No code duplication — single `startServerFresh` function serves both commands

## Impact

All users of `stigmer server reset` (without `--include-config`). After reset, users see the same phased progress, LLM status, MCP discovery, and "Ready! Stigmer server is running" output as they would from `stigmer server`.

---

**Status**: ✅ Production Ready
