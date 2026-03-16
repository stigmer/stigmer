# Remove Deprecated Packages and Fix npm Release Pipeline

**Date**: March 16, 2026

## Summary

Deleted 6 deprecated workspace packages (`_libs/domain/*` and `_libs/infra/rpc-client`) that were fully superseded by `@stigmer/sdk` and `@stigmer/react` in the Phase 1/2 restructuring. Fixed the npm release pipeline so all 4 publishable packages (`@stigmer/protos`, `@stigmer/sdk`, `@stigmer/react`, `@stigmer/theme`) build and publish correctly with proper version pinning.

## Problem Statement

After the SDK restructuring (Sessions 1-4), the repository was in a transitional state:

### Pain Points

- 6 dead packages remained on disk under `_libs/domain/` and `_libs/infra/`, creating confusion for contributors and bloating the working directory with ~3,400 lines of obsolete code
- `build:libs` and `clean:libs` scripts only covered `@stigmer/protos` and `@stigmer/theme`, omitting the two new SDK packages — `publish-libs.mjs` would fail at publish time
- `@stigmer/sdk` and `@stigmer/react` declared `"@stigmer/protos": "0.0.0-dev"` in peerDependencies; the `pinWorkspaceDeps()` function only pins `"*"` versions, so published packages would ship with an unsatisfiable peer requirement
- `@stigmer/theme` had no `tsconfig.build.json`, so its `build` script would fail when invoked outside Next.js

## Solution

Two-part cleanup: remove dead code, then fix the release pipeline.

### Part 1: Dead Code Removal

- Deleted `client-apps/web/_libs/domain/` (5 packages: agent, agent-execution, session, skill, mcp-server)
- Deleted `client-apps/web/_libs/infra/` (rpc-client — the only package in this directory)
- Updated `_libs/README.md` to reflect the current architecture (only `@stigmer/theme` remains)
- Removed stale `_libs/domain` and `_libs/infra` entries from `client-apps/web/tsconfig.json` exclude

### Part 2: Release Pipeline Fix

- Updated `build:libs` / `clean:libs` in root `package.json` to include all 4 publishable packages in dependency order: `@stigmer/protos` → `@stigmer/sdk` → `@stigmer/theme` → `@stigmer/react`
- Changed `"0.0.0-dev"` to `"*"` for all `@stigmer/*` peer dependency cross-references (consistent with the existing `@stigmer/theme: "*"` pattern)
- Created `tsconfig.build.json` for `@stigmer/theme` with declaration and declarationMap support
- Verified full pipeline with `publish-libs.mjs --dry-run`: all 4 packages build, generate correct `dist/package.json` with pinned versions, and pass `npm publish --dry-run`

## Implementation Details

### Files Deleted (68 files, ~3,400 lines removed)

| Package | Path | Lines |
|---------|------|-------|
| `@stigmer/agent` | `_libs/domain/agent/` | ~700 |
| `@stigmer/agent-execution` | `_libs/domain/agent-execution/` | ~1,500 |
| `@stigmer/session` | `_libs/domain/session/` | ~530 |
| `@stigmer/skill` | `_libs/domain/skill/` | ~130 |
| `@stigmer/mcp-server` | `_libs/domain/mcp-server/` | ~130 |
| `@stigmer/rpc-client` | `_libs/infra/rpc-client/` | ~600 |

### Files Modified

| File | Change |
|------|--------|
| `package.json` | `build:libs` / `clean:libs` now include `@stigmer/sdk` and `@stigmer/react` |
| `sdk/typescript/package.json` | `peerDependencies.@stigmer/protos`: `"0.0.0-dev"` → `"*"` |
| `sdk/react/package.json` | `peerDependencies.@stigmer/sdk` and `.@stigmer/protos`: `"0.0.0-dev"` → `"*"` |
| `client-apps/web/tsconfig.json` | Removed `_libs/domain` and `_libs/infra` from exclude |
| `client-apps/web/_libs/README.md` | Rewritten for current architecture |

### Files Created

| File | Purpose |
|------|---------|
| `client-apps/web/_libs/ui/theme/tsconfig.build.json` | Build config for standalone `@stigmer/theme` compilation |

### Build Order (dependency graph)

```
@stigmer/protos
    ↓
@stigmer/sdk (depends on protos)
    ↓
@stigmer/theme (independent, but built before react)
    ↓
@stigmer/react (depends on sdk + theme)
```

### Peer Dependency Pinning

The `publish-libs.mjs` script's `pinWorkspaceDeps()` function replaces `"*"` with the release version for all `@stigmer/*` references. By standardizing on `"*"` in source `package.json` files, the pipeline correctly produces:

```json
// dist/package.json for @stigmer/sdk at version 1.0.0
"peerDependencies": {
  "@stigmer/protos": "1.0.0"
}

// dist/package.json for @stigmer/react at version 1.0.0
"dependencies": {
  "@stigmer/theme": "1.0.0"
},
"peerDependencies": {
  "@stigmer/sdk": "1.0.0",
  "@stigmer/protos": "1.0.0"
}
```

## Benefits

- **No dead code**: 68 files and ~3,400 lines of obsolete code removed from the working directory
- **Working release pipeline**: `publish-libs.mjs` can now build and publish all 4 packages end-to-end
- **Correct version pinning**: Published packages declare satisfiable peer dependency versions
- **Clean contributor experience**: No confusion about which packages are active vs deprecated

## Impact

- **Package maintainers**: The release pipeline is now functional — `make release` will publish all 4 npm packages correctly
- **External consumers**: Published packages will have correct peer dependency requirements
- **Contributors**: Cleaner repository with only active code in the workspace

## Known Issue

`next build` fails with Turbopack due to `.js` extensions in TypeScript source imports across `@stigmer/sdk` and `@stigmer/react`. This is a pre-existing issue from the codegen phase (Session 2) — `tsc --noEmit` passes cleanly. Tracked as a separate task.

## Related Work

- [TypeScript SDK codegen](2026-03-16-123359-typescript-sdk-codegen-all-resources.md) — Created the packages this cleanup supports
- [React package consolidation](2026-03-16-131925-react-package-consolidation.md) — Migrated domain packages to `@stigmer/react`

---

**Status**: Production Ready
**Timeline**: ~30 minutes
