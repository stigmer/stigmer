# Stable Machine Identity for Runner Adoption

**Date**: May 9, 2026

## Summary

Introduced a persistent machine identity (`~/.stigmer/machine.json`) that decouples runner adoption from hostname-derived slugs. Runners can now survive hostname changes without breaking the "already running = success" UX established in T01/T02. This is Phase 2 of the runner management UX overhaul.

## Problem Statement

Runner identity was `sanitizeToSlug(os.Hostname())`, used as both the local state file key and the backend resource slug. This single-layer identity breaks silently in common scenarios.

### Pain Points

- Connecting to a different WiFi network changes macOS hostname (appends `.local` suffix)
- Renaming the computer creates a "new" runner identity, leaving the old one orphaned
- Two machines with similar hostnames collide after slug sanitization
- Users see confusing errors when hostname drift causes identity mismatch

## Solution

Two-layer identity model:
- **`machine_id`** — stable, opaque (`mach_` + 32 hex chars), generated once, persisted forever. Used for local adoption and deduplication.
- **`slug/name`** — human-readable, hostname-derived, mutable. Used for API URLs, CLI display, and UI labels. Unchanged from before.

## Implementation Details

**Machine ID generation** (`machine.go`):
- 128 bits of `crypto/rand` randomness, hex-encoded, prefixed with `mach_`
- Persisted to `~/.stigmer/machine.json` with `0600` permissions
- Idempotent: once created, reused forever; corrupt files auto-regenerate

**Proto change** (additive, non-breaking):
- Added `string machine_id = 5` to `RunnerConnectionInfo` message
- Sent on every heartbeat and included in `EnsureResult` JSON output
- Server currently stores but does not act on this field (T07 will activate)

**Adoption logic** (`checkOrAdopt`):
- Primary path unchanged: lookup by slug (filename)
- New fallback: if slug lookup fails, scan all state files for matching `machine_id`
- Handles hostname changes gracefully — old state file found by machine_id

**State migration**:
- `MachineID` field added to `RunnerState` (JSON `omitempty` for backward compat)
- Lazy backfill: existing state files get `machine_id` written on first adoption

## Benefits

- Hostname changes no longer break `stigmer up` adoption
- Desktop auto-adoption survives macOS hostname drift across networks
- `stigmer status` correctly identifies "my runner" regardless of hostname
- Foundation laid for server-side dedup (T07) without requiring server changes now
- Zero new dependencies (standard library `crypto/rand` only)

## Impact

- **CLI users**: Seamless experience when hostname changes — no more orphaned runners
- **Desktop users**: Tauri sidecar consumes `machine_id` from `--json` output for future settings display
- **Backend**: Receives `machine_id` on heartbeats (informational for now; actionable in T07)
- **Backward compatible**: Old state files without `machine_id` still work; they just can't be found by machine_id scan until backfilled

## Related Work

- T01 (Phase 0): Already running = success — `checkOrAdopt` adoption
- T02 (Phase 1): Idempotent `Ensure()` with structured JSON output
- T07 (Phase 6, future): Server-side uniqueness by `(org, machine_id)` instead of `(org, slug)`

---

**Status**: Production Ready
**Project**: `_projects/2026-05/20260509.02.runner-management-ux-overhaul`
