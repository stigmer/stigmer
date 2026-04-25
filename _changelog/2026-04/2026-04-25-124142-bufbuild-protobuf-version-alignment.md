# Fix `@bufbuild/protobuf` version mismatch breaking site typecheck

**Date**: April 25, 2026

## Summary

Upgraded `@bufbuild/protobuf` from 2.11.0 to 2.12.0 across all workspace lockfiles to resolve 897 TypeScript errors that were failing the `make check` site typecheck step. The root cause was a version split between the root workspace (2.11.0) and the site project (2.12.0), making protobuf descriptor types structurally incompatible.

## Problem Statement

`make check` was failing with exit code 2 on the `site typecheck` target.

### Pain Points

- **897 TypeScript errors** across 84 files (22 in `site/src/`, 62 in `node_modules/@stigmer/*`)
- All errors stemmed from a single root cause: two different versions of `@bufbuild/protobuf` in the dependency tree
- The site project (using its own yarn lockfile) resolved `@bufbuild/protobuf@^2.11.0` to **2.12.0**, while the root npm workspace had it pinned at **2.11.0**
- Version 2.12.0 added new properties (`removalError` on `FieldOptions_FeatureSupport`, `utf8Validation` on `descFieldAndExtensionShared`), making the types structurally incompatible between the two copies

## Solution

Ran `npm install` in the root workspace, which resolved `@bufbuild/protobuf` to 2.12.0 (the latest version satisfying all `^2.x` range specifiers). This aligned root, site, and all workspace packages on the same version, eliminating the type mismatch.

## Implementation Details

- **`package-lock.json`**: `@bufbuild/protobuf` 2.11.0 → 2.12.0
- **`yarn.lock`** (legacy, kept in sync): same version bump
- **`site/yarn.lock`**: hash updates for `@stigmer/protos`, `@stigmer/react`, and `@stigmer/sdk` file references (they now resolve protobuf to 2.12.0 consistently)
- **`apis/stubs/ts/package.json`**: pinned `@bufbuild/protobuf` to `2.12.0` (was `^2.5.1`)
- **`client-apps/web/package.json`**: pinned `@bufbuild/protobuf` to `2.12.0` (was `^2.11.0`)

## Benefits

- `make check` passes cleanly (exit code 0)
- All 35 backend tests continue to pass
- All demo scenario validations pass (34 demos across 26 pages)
- Eliminates a class of "phantom" TypeScript errors that originate from dependency version drift

## Impact

- **Site development**: Developers can now run typecheck and build the site without errors
- **CI**: `make check` gate is green again
- **Dependency hygiene**: Both lockfiles are aligned, reducing risk of future version splits

---

**Status**: ✅ Production Ready
