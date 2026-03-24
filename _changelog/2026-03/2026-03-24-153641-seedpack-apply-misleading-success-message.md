# Fix Misleading Seedpack Apply Success Message

**Date**: March 24, 2026

## Summary

Fixed a bug where `stigmer seedpack apply` always displayed "Seedpack applied" even when the operation was silently skipped due to a matching idempotency marker. The CLI now correctly distinguishes between an actual apply and a no-op skip, showing "Seedpack already up to date" when the content hash matches.

## Problem Statement

Running `stigmer seedpack apply` against a cloud backend reported success ("Seedpack applied to cloud backend") but no resources appeared on the cloud. The command was indistinguishable from a successful apply when the seedpack was actually being skipped.

### Pain Points

- The idempotency marker file (`~/.stigmer/.seedpack-bootstrapped`) persisted across cloud resets/redeployments, causing all subsequent applies to be silently skipped
- The success message was identical whether the seedpack was actually applied or skipped, making it impossible to tell what happened without `--debug` logging
- Users had to know about `--force` to work around the issue, with no indication from the CLI that skipping occurred

## Solution

Changed `seedpackbootstrap.Apply` to return `(bool, error)` instead of `error`, where the boolean indicates whether the seedpack was actually applied (`true`) or skipped (`false`). Updated both callers to handle the new return value, with the CLI command showing distinct messages for each case.

## Implementation Details

### Changed: `seedpackbootstrap/bootstrap.go`

- `Apply` signature changed from `func Apply(opts Options) error` to `func Apply(opts Options) (bool, error)`
- Returns `false, nil` for skip paths (recursion guard, hash match)
- Returns `true, nil` after successful apply
- Returns `false, err` on any error

### Changed: `cmd/stigmer/root/seedpack.go`

- `handleSeedpackApply` now checks the boolean return value
- Shows "Seedpack applied to %s backend" when `applied == true`
- Shows "Seedpack already up to date on %s backend (use --force to re-apply)" when `applied == false`

### Changed: `cli/daemon/daemon.go`

- `EnsureSeedpackBootstrapped` discards the boolean (daemon only cares about errors)

## Benefits

- Users immediately know whether the seedpack was actually applied or skipped
- The "use --force to re-apply" hint guides users to the correct action after a cloud reset
- No more debugging required to understand why cloud resources are missing after a seemingly successful apply

## Impact

Affects all users of `stigmer seedpack apply` (both local and cloud backends). The daemon startup path (`EnsureSeedpackBootstrapped`) is unchanged in behavior — it still silently skips when up to date, which is the correct behavior for automatic background bootstrapping.

---

**Status**: ✅ Production Ready
