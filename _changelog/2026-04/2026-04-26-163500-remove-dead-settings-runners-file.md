# Remove Dead SettingsRunners File from Desktop App

**Date**: April 26, 2026

## Summary

Removed the orphaned `SettingsRunners.tsx` file from `pages/settings/` in the desktop app. This file was dead code -- `routes.tsx` had already been updated to import `RunnersPage` from `pages/runners/`, leaving `SettingsRunners.tsx` as an unreferenced module that was being maintained in parallel.

## Problem Statement

When runners were promoted from a settings sub-page to a top-level route (commit `076575038`), the `pages/runners/RunnersPage.tsx` file was created and wired into the router, but the original `pages/settings/SettingsRunners.tsx` was not deleted. Subsequent commits (e.g., `39075303f`) applied the launch token exchange changes to both files, doubling the maintenance surface for identical logic.

### Pain Points

- Two copies of the same page component diverging silently (different import paths, different function names)
- Contributors might edit the wrong file, with changes never reaching users
- `grep` results for runner-related logic returning a stale file alongside the active one

## Solution

Deleted `client-apps/desktop/src/pages/settings/SettingsRunners.tsx`. Verified that no module in the codebase imports it.

## Implementation Details

- Confirmed `SettingsRunners` is not referenced by `routes.tsx` (which uses `RunnersPage` from `pages/runners/`)
- Confirmed no other file imports from `pages/settings/SettingsRunners`
- `make verify-desktop` passes with 0 errors (9 pre-existing warnings in unrelated files)

## Benefits

- Single source of truth for the runners page component
- No risk of stale-file edits going unnoticed
- Cleaner `pages/settings/` directory containing only genuine settings concerns (`SettingsLayout`, `SettingsLanding`)

## Impact

- **Desktop app only** -- no web or SDK changes
- Zero user-visible behavior change (the deleted file was never loaded at runtime)

## Related Work

- Promote Runners to top-level navigation (`2026-04-26-155351-promote-runners-to-top-level-navigation.md`)
- Desktop runner launch token exchange (`2026-04-26-163214-desktop-runner-launch-token-exchange.md`)

---

**Status**: ✅ Production Ready
