# Workstream C: Architectural Metrics Enforcement

**Date**: April 23, 2026

## Summary

Activated the dormant `sdk-import-boundaries` ESLint rule for `@stigmer/react` by adding a dedicated ESLint pass to the SDK package, created a focused `make verify-web` CI target for fast web-layer feedback, and documented baseline architectural health metrics with reproducible measurement commands.

## Problem Statement

The SDK/Console boundary enforcement existed in code but was never actually running. The `eslint-plugin-stigmer` package had a well-implemented `sdk-import-boundaries` rule that forbids `next/*` and `@/` imports in SDK source files. However, ESLint only ran from `client-apps/web/`, so SDK files under `sdk/react/src/` were never visited. The architectural claims in the role files and cursor rule were aspirational, not enforced.

### Pain Points

- `@stigmer/react` had zero ESLint infrastructure — no config, no lint script, no ESLint devDependency
- `make lint` ran `npm run typecheck -w @stigmer/sdk` but completely skipped `@stigmer/react` (no lint, no typecheck)
- No quantitative baseline existed for SDK/Console boundary health
- Web developers had no fast feedback target — `make lint` runs Go, Python, proto, and docs linters (~minutes), when they only needed web-layer checks (~seconds)

## Solution

Three deliverables that close the enforcement gap without changing the existing rule logic:

1. **`sdk/react/eslint.config.mjs`** — Minimal ESLint 9 flat config with `@typescript-eslint/parser` and all three stigmer plugin rules
2. **`make verify-web` Makefile target** — Focused lint+typecheck for `@stigmer/react`, `@stigmer/sdk`, and `client-apps/web`
3. **Baseline metrics document** — Five metrics with current values and reproducible commands

## Implementation Details

### ESLint Config for `sdk/react/`

Created a minimal flat config that enables boundary enforcement without adding unnecessary dependencies:

- `stigmer/sdk-import-boundaries`: **error** — the primary boundary enforcement
- `stigmer/no-token-opacity-modifiers`: **warn** — catches theme token violations in SDK styled components
- `stigmer/no-main-tokens-in-sidebar`: **warn** — catches sidebar/main token context misuse

Design decision: config only enables stigmer plugin rules, not `@typescript-eslint/*` rules. TypeScript type safety is already enforced by `tsc --noEmit` with `strict: true`. The ESLint pass is specifically for boundary enforcement.

Added `eslint` and `@typescript-eslint/parser` to `sdk/react` devDependencies. Added `lint` and `lint:fix` scripts.

### Makefile Changes

- **`verify-web` target**: Runs SDK react lint, SDK react typecheck, SDK typecheck, and web lint in sequence (~5s on warm cache)
- **`lint` target**: Added `npm run lint -w @stigmer/react` and `npm run typecheck -w @stigmer/react`
- **`fix` target**: Added `npm run lint:fix -w @stigmer/react`

### Baseline Metrics

| Metric | Value | Target |
|--------|-------|--------|
| `next/*` imports in SDK | 0 | 0 |
| `@/` imports in SDK | 0 | 0 |
| Console imports of `@stigmer/react` | 30 files, 34 lines | Track |
| Hook-to-component export ratio | 101/91 = 1.11 | >= 1.0 |
| Hardcoded colors in Console | 3 (documented exception) | 0 |
| Opacity modifier warnings in SDK | 312 | 0 (future work) |

### Bonus Fix

Removed a stray `eslint-disable-next-line @next/next/no-img-element` comment from `sdk/react/src/organization/OrgProfilePanel.tsx`. This was a Next.js linting artifact that had no business in an SDK file — the SDK uses standard `<img>` elements, not Next.js `<Image>`.

## Benefits

- **Boundary enforcement is now real**: Any future `import from 'next/...'` in `sdk/react/src/` will fail the lint with a clear error message
- **Fast feedback for web developers**: `make verify-web` runs in ~5s vs minutes for `make lint`
- **Quantitative baseline**: Metrics document provides reproducible commands for tracking architectural health over time
- **Pre-existing issues surfaced**: Discovered that `make lint` was already broken (Go vet failure, codegen typecheck failure) — these predate this work but are now documented

## Impact

- **SDK package** (`@stigmer/react`): Now has lint infrastructure for the first time
- **CI pipeline** (`make lint`): Now includes SDK react lint and typecheck
- **Developer workflow**: New `make verify-web` target for fast local verification
- **Architecture documentation**: Baseline metrics established before Console domain reorganization (Workstream B)

## Related Work

- **Workstream A** (complete): Codified design decisions DD-001 through DD-008 and dont-dos 001 through 005
- **Workstream B** (next): Console domain reorganization — will use these metrics to verify the restructuring doesn't degrade boundary health
- **Project**: `_projects/2026-04/20260423.01.web-sdk-architecture-standards/`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
