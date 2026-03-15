# Audit and Fix npm Publishing Pipeline for @stigmer/* Packages

**Date**: March 15, 2026

## Summary

Audited and hardened the npm publishing pipeline for the four `@stigmer/*` packages (`protos`, `rpc-client`, `theme`, `react-ui`). Fixed a critical double-publish bug, added missing package metadata, enhanced the publish script for better developer experience, and validated the entire flow end-to-end.

## Problem Statement

The npm publishing setup was functional but had several quality gaps that would surface in production:

### Pain Points

- **Double publishing**: The root `Makefile` called `libs-publish` locally, and the `v*` tag push also triggered `release.npm-libs.yaml` CI workflow — both attempting to publish the same version, causing 409 "version already exists" errors
- **Missing metadata**: No `license`, `engines`, or `keywords` in any package, and `repository.url` used wrong format
- **Poor IDE experience**: `declarationMap: true` was set but source `.ts` files weren't shipped, making "Go to Definition" resolve to unreadable `.d.ts` files
- **No README**: None of the 4 packages had README.md files — poor first impression on npmjs.com
- **Build hygiene**: `module: "esnext"` (moving target), unnecessary `npx` wrapper for tailwindcss

## Solution

Systematic audit categorized issues by severity (critical/important/minor), created a 7-step execution plan, and implemented all fixes with end-to-end validation.

## Implementation Details

### Critical: Double-Publish Fix
Removed `$(MAKE) -C client-apps/web libs-publish VERSION=...` from the root `Makefile`'s `release` target. CI (`release.npm-libs.yaml`) is now the sole publisher. `make release` only pushes tags.

### Important: Package Metadata
Added to all 4 `package.json` files:
- `"license": "Apache-2.0"`
- `"engines": { "node": ">=18" }`
- `"keywords": [...]` (package-specific)
- `"repository.url"`: corrected to `git+https://` format

### Important: Publish Script Enhancement (`scripts/publish-libs.mjs`)
- `generateDistPackageJson()` now propagates `engines` and `keywords`
- New `copySrcForDeclarationMaps()` copies `.ts`/`.tsx`/`.css` source into `dist/src/`
- Root `LICENSE` file copied into each package's `dist/`

### Important: README.md Files
Created for all 4 packages with install instructions, usage examples, API summaries, and subpath export documentation.

### Minor: Build Config Fixes
- `tsconfig.base.json`: `module: "esnext"` → `"ES2022"` (stable emit)
- `react-ui/package.json`: `npx @tailwindcss/cli` → `tailwindcss` (eliminates npx overhead)

## Benefits

- **Zero-conflict publishing**: Single publisher (CI) eliminates race conditions and 409 errors
- **npm best practices**: All packages pass `npm publish` metadata validation without warnings
- **IDE "Go to Definition"**: Navigates to readable `.ts` source instead of generated `.d.ts`
- **Professional presentation**: README + LICENSE on npmjs.com package pages
- **Reproducible builds**: Pinned ES module target eliminates emit behavior drift

## Impact

- **Platform teams**: Downstream consumers of `@stigmer/*` packages get proper metadata, IDE navigation, and documentation
- **CI/CD**: Release workflow simplified — tag push triggers everything, no manual npm publish step
- **Maintainers**: Clean publish script with all metadata propagation handled centrally

## Related Work

- Part of project `20260315.01.web-libs-setup` (tasks T01–T06)
- Builds on T01–T05 which established the `_libs` workspace, created packages, and migrated the console
- Publish script (`scripts/publish-libs.mjs`) and CI workflow (`release.npm-libs.yaml`) from prior work

---

**Status**: Production Ready
**Timeline**: ~2 hours (audit + plan + implementation + validation)
