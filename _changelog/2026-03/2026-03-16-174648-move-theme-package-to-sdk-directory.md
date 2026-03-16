# Move @stigmer/theme Package to SDK Directory

**Date**: March 16, 2026

## Summary

Relocated `@stigmer/theme` from `client-apps/web/_libs/ui/theme/` to `sdk/theme/`, fixing an inverted dependency where an SDK package depended on a client-app internal library. Also fixed the npm publish script which had the stale path and incorrect package ordering.

## Problem Statement

`@stigmer/theme` is a published npm package consumed by `@stigmer/react` and by external platform builders. It lived at `client-apps/web/_libs/ui/theme/` — a location whose `_libs` convention signals "non-publishable internal."

### Pain Points

- **Inverted dependency**: `@stigmer/react` (an SDK package under `sdk/`) depended on a package nested inside `client-apps/web/_libs/` — the dependency arrow pointed inward instead of outward
- **Misleading location**: the `_libs` convention implies non-publishable internals, but `@stigmer/theme` is a first-class SDK surface that platform builders `npm install` directly
- **Inconsistent with siblings**: `@stigmer/sdk` lives at `sdk/typescript/`, `@stigmer/react` at `sdk/react/`, but `@stigmer/theme` was buried in `client-apps/web/_libs/ui/theme/`
- **Stale publish script**: `scripts/publish-libs.mjs` referenced the old path and had `sdk/react` listed before `sdk/theme` despite react depending on theme

## Solution

Physical directory move via `git mv` with workspace configuration updates. Zero import changes required because all consumers reference `@stigmer/theme` by package name, not relative path.

## Implementation Details

### Files moved

| From | To |
|------|-----|
| `client-apps/web/_libs/ui/theme/*` | `sdk/theme/*` |

### Files modified

| File | Change |
|------|--------|
| `package.json` (root) | Replaced `client-apps/web/_libs/ui/*` with `sdk/theme` in workspaces array |
| `sdk/theme/package.json` | Updated `repository.directory` to `sdk/theme` |
| `sdk/theme/tsconfig.json` | Made self-contained (removed `extends` to old `_libs/tsconfig.base.json`), aligned with `sdk/typescript/` and `sdk/react/` tsconfig patterns |
| `scripts/publish-libs.mjs` | Updated PACKAGES path from old location to `sdk/theme`; corrected publish order to theme-before-react |

### Files removed

| File | Reason |
|------|--------|
| `client-apps/web/_libs/README.md` | Orphaned after theme move (only package under `_libs/ui/`) |
| `client-apps/web/_libs/tsconfig.base.json` | Orphaned; theme tsconfig now self-contained |

### What did NOT change

- npm package name: still `@stigmer/theme`
- All 32+ import statements across Console and SDK: unchanged (resolve by package name)
- `next.config.ts` transpilePackages: still references `@stigmer/theme` by name
- Package contents (tokens.css, presets, cn utility, THEME_PRESETS): identical

## Benefits

- **Correct dependency direction**: SDK packages now depend on sibling SDK packages, not on client-app internals
- **Discoverable**: platform builders browsing the repo find all SDK packages under `sdk/`
- **Consistent structure**: `sdk/typescript/`, `sdk/theme/`, `sdk/react/` — clean, predictable layout
- **Publish pipeline fixed**: correct package path and dependency-respecting publish order

## Impact

- **Platform builders**: no change — npm package name and API identical
- **Console developers**: no change — imports resolve transparently
- **CI/CD**: `scripts/publish-libs.mjs` now correctly locates and orders the theme package
- **Contributors**: theme source is now where you'd expect it (`sdk/theme/`)

## Verification

- `npm install` resolves all workspace links correctly
- `npm run build:libs` passes full chain: protos -> sdk -> theme -> react
- `publish-libs.mjs --dry-run` succeeds for all 4 packages from correct directories

---

**Status**: Production Ready
