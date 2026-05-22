# Fix Desktop Runner Temporal Connection Env Var Mismatch

**Date**: May 22, 2026

## Summary

Fixed a critical env var name mismatch that caused the desktop embedded runner to connect to the wrong Temporal cluster. The Tauri bridge set `TEMPORAL_ADDRESS` but the runner read `TEMPORAL_SERVICE_ADDRESS`, causing it to silently fall back to `localhost:7233` instead of the production cluster. Also added explicit Temporal address configuration via Vite env vars.

## Problem Statement

After enabling per-execution workflow queue routing (earlier today), workflow executions triggered from the desktop app were stuck indefinitely. The Java orchestrator started child workflows on `wfexec:{id}` queues on the production Temporal cluster, but no worker ever polled those queues.

### Pain Points

- Workflow executions appeared "Running" in Temporal UI but never progressed
- The child workflow task sat in the `wfexec:{id}` queue with zero pollers
- The bug was dormant before per-execution routing because the global `stigmer_runner` queue was never used from the desktop runner path
- No error was surfaced — the runner silently connected to localhost:7233

## Solution

Two-part fix: correct the env var name mismatch, and add explicit Temporal address configuration via Vite environment variables.

## Implementation Details

### Env var name alignment (Tauri → Runner)

`runner.rs` set `TEMPORAL_ADDRESS` on the spawned process, but the runner's `config.ts` reads `TEMPORAL_SERVICE_ADDRESS`. Changed the Rust side to use the correct name:

```rust
// Before:
cmd.env("TEMPORAL_ADDRESS", &config.temporal_address);

// After:
cmd.env("TEMPORAL_SERVICE_ADDRESS", &config.temporal_address);
```

The same mismatch existed in the CLI daemon (`daemon_process.go`), fixed there as well.

### Explicit Temporal address via Vite env vars

Added `VITE_STIGMER_TEMPORAL_ADDRESS` to the desktop app configuration:

- `.env.development`: `stigmer-prod-temporal-frontend.planton.live:7233`
- `.env.production`: `stigmer-prod-temporal-frontend.planton.live:7233`
- `useEmbeddedRunner.ts`: reads env var first, localStorage second, localhost fallback last
- `vite-env.d.ts`: TypeScript type declaration

### Configuration priority chain (after fix)

1. `VITE_STIGMER_TEMPORAL_ADDRESS` (from .env file — primary)
2. `localStorage["stigmer.temporalAddress"]` (manual override)
3. `"localhost:7233"` (fallback for truly local development)

## Benefits

- Desktop workflow executions now connect to the correct Temporal cluster
- Per-execution routing (`wfexec:{id}`) works end-to-end from the desktop app
- CLI daemon runner also gets the correct env var name (latent bug fixed)
- Explicit configuration via `.env` files — no more reliance on localStorage hacks

## Impact

- **Desktop app**: Workflow executions will connect to the production Temporal cluster when running in development mode
- **CLI daemon**: Latent env var mismatch fixed (was previously masked by parent env inheritance)
- **Integration tests**: Unaffected (bypass Tauri, construct options directly)

## Related Work

- Per-execution workflow queue routing (earlier today, `2026-05-22-133923`)
- Desktop embedded runner and session routing (May 20, 2026)
- Unified runner migration (May 18-21, 2026)

---

**Status**: ✅ Production Ready
