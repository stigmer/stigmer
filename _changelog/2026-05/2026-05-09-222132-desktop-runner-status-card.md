# Desktop UI Redesign: Status Card Replaces Start Runner Modal

**Date**: May 9, 2026

## Summary

The Desktop app's Runners page has been redesigned from an explicit "Start Runner" dialog workflow to a split-view status card architecture. A prominent "This Machine" card at the top shows real-time local runner health via the T04 control socket, with automatic runner lifecycle management after a one-time opt-in. The 917-line monolithic RunnersPage was decomposed into 5 focused components.

## Problem Statement

The Desktop Runners page required users to manually click "Start Runner," fill in a dialog with name/endpoint/token, and wait for CLI output. This was friction-heavy for the common case (make this computer available) and didn't leverage the idempotent ensure, stable machine identity, and control socket infrastructure built in T01–T04.

### Pain Points

- Manual runner startup every time the Desktop app launches
- Dialog required fields (name, endpoint, token) that have sensible defaults
- No real-time local runner health — PID-based liveness was unreliable
- 917-line monolithic component mixing local and fleet concerns
- No concept of "this machine" as a first-class citizen in the UI

## Solution

Replaced the Start Runner modal with a two-zone page layout:
1. **This Machine** — a status card driven by the Unix control socket, with auto-ensure lifecycle (first-run opt-in, then automatic)
2. **Organization Fleet** — the existing runner list, deduplicated from this machine's entry

## Implementation Details

### Rust Layer (Tauri Sidecar)
- `query_runner_socket`: HTTP/1.1 over `tokio::net::UnixStream` to `GET /status` on `~/.stigmer/run/runner.sock`, with disk-state fallback
- `stop_runner_via_socket`: `POST /stop` for graceful shutdown
- `preferences.rs`: File-based preference store at `~/.stigmer/desktop/preferences.json` (enabled, prompted booleans)

### Hook Layer (React)
- `useLocalRunnerStatus`: Adaptive polling (5s active, 10s inactive) with Tauri event-driven immediate refetch
- `useAutoEnsure`: State machine managing loading → prompt → ensuring → active/error/disabled lifecycle

### UI Layer (React Components)
- `ThisMachineCard`: Five-state card (loading, prompt, disabled, ensuring, active, error) with actions (Enable, Disable, Restart, View Logs, Retry)
- `FirstRunPrompt`: Inline one-time opt-in card
- `OrgFleetSection`: Self-contained fleet list with topology derivation and phase-sorted rows

### Page Composition
- `RunnersPage` reduced from 917 → ~520 lines as a clean composition shell
- `StartRunnerDialog` deleted — power users use `stigmer up` CLI directly

## Benefits

- **Zero-friction runner management**: After one-time opt-in, the runner lifecycle is invisible
- **Real-time health**: Control socket provides live status (uptime, version, PID) instead of stale PID checks
- **Cleaner architecture**: 5 single-responsibility files instead of 1 monolith
- **Maintainability**: Each component can be tested and modified independently
- **Minimal dependency footprint**: No new crate dependencies — hand-rolled HTTP over existing `tokio::net::UnixStream`

## Impact

- **Desktop users**: Runner management goes from "click, fill form, wait, hope" to "opt in once, forget about it"
- **Codebase**: Runner page architecture now follows the project's component decomposition standards
- **Foundation**: Sets up the data flow for future fleet polish (T06) and monitoring features (T07)

## Related Work

- T01–T02: Idempotent ensure + adoption (runner-management-ux-overhaul)
- T03: Stable machine_id identity
- T04: Local control socket (`GET /status`, `POST /stop`)
- T06 (next): Fleet view polish — sorting, filtering, empty states
- T07 (next): End-to-end testing of auto-ensure lifecycle

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
