# Desktop App: CI Lint Gate and Unified Release Versioning

**Date**: April 24, 2026

## Summary

Added ESLint linting to the desktop app and wired it into the repository's `make check` CI gate. Simultaneously unified the desktop release workflow to use the shared `v*` tag pattern, bringing it in line with all other release artifacts (CLI, npm libs, Python SDK, Maven, MCP server, Buf, sandbox) so every component shares one version number.

## Problem Statement

The desktop app was introduced without lint tooling and was not part of the repository's local CI gate (`make check`). Additionally, its release workflow used a separate `desktop-v*` tag prefix, making it the only artifact with an independent versioning scheme.

### Pain Points

- Desktop TypeScript code had no linting — theme token violations and import boundary issues could ship undetected
- `make check` (the full local CI gate) did not include the desktop app — contributors could break desktop code without noticing
- The `desktop-v*` tag prefix meant the desktop had a separate release lifecycle from every other artifact, creating version fragmentation
- `make release` printed "Desktop app is released separately" instead of including it in the unified release flow

## Solution

Three coordinated changes: add ESLint to the desktop workspace, wire desktop verification into the CI gate, and migrate the release workflow from `desktop-v*` to the shared `v*` tag.

## Implementation Details

### Desktop ESLint Setup

- Created `client-apps/desktop/eslint.config.mjs` following the `sdk/react` ESLint config pattern (TypeScript parser, stigmer plugin rules)
- Added `lint` and `lint:fix` scripts to `client-apps/desktop/package.json`
- Added `eslint`, `@typescript-eslint/parser`, and `eslint-plugin-stigmer` as dev dependencies
- Configured ignores for `dist/`, `node_modules/`, and `src-tauri/` (Rust code)

### CI Gate Integration

- Updated `verify-desktop` Makefile target to run both `lint` and `typecheck` (was typecheck-only)
- Added `verify-desktop` to the `check` target dependency chain (between `web-build` and `docs-build`)
- Added `verify-desktop` to `.PHONY` declaration

### Unified Release Tag

- Changed `release.desktop.yaml` trigger from `desktop-v*` to `v*`
- Updated `determine-version` job to use plain `v*` tag (removed `desktop-` prefix from test version)
- Updated tauri-action `tagName` and `releaseName` to use the version output directly
- Removed the standalone `desktop-release` Makefile target (37 lines)
- Updated `make release` help text to include desktop in the list of CI-triggered artifacts
- Updated `site/src/lib/constants.ts` to reference `v0.1.0` tag instead of `desktop-v0.1.0`

## Benefits

- Desktop code is now linted with the same stigmer theme token rules as the web console and React SDK
- `make check` catches desktop issues locally before they reach CI
- Single `v*` tag triggers all 8 release workflows — one version number for the entire platform
- `make release bump=patch` is the single command for releasing everything, including desktop

## Impact

- **Contributors**: Desktop code changes are now caught by the local CI gate
- **Release process**: Simplified from two separate tagging commands to one unified flow
- **Version communication**: "Stigmer v1.5.0" now unambiguously refers to every artifact at that version

## Related Work

- Desktop app Tauri setup and CI pipeline (2026-04-23)
- Desktop app promotion in web console and marketing site (2026-04-24)

---

**Status**: ✅ Production Ready
