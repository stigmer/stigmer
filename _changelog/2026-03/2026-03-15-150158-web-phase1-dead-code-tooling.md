# Web Architecture Alignment — Phase 1: Dead Code Removal & Tooling Setup

**Date**: March 15, 2026

## Summary

Completed Phase 1 of the Web Architecture & UX Alignment project: removed dead code, fixed a routing bug, and established Prettier + hardened ESLint as the codebase's formatting and quality baseline. This clears technical debt and sets the foundation for all subsequent architectural and UX work across the remaining 8 phases.

## Problem Statement

The Stigmer web console had accumulated dead code, lacked consistent formatting enforcement, and had permissive linting rules that allowed `any` types and unused variables to proliferate unchecked.

### Pain Points

- 2 entirely dead component files (`tooltip.tsx`, `textarea.tsx`) adding confusion about which component to use
- 8 dead re-exports across service files creating the illusion of a larger API surface
- 2 unused service functions (`searchSkills`, `searchMcpServers`) adding maintenance burden
- 1 unused utility function (`formatDateTime`) alongside its actively-used sibling
- 1 routing bug where the dashboard "Browse Catalog" card linked to `/agents` instead of `/catalog`
- No Prettier configuration — inconsistent formatting across 80+ source files
- ESLint allowed `any` types and unused variables without complaint

## Solution

A two-task approach: first remove all dead code and fix bugs (T01), then establish tooling guardrails (T02). The tasks are sequenced so dead code is removed before Prettier reformats, keeping the formatting commit clean.

## Implementation Details

### T01: Dead Code Removal

**Deleted files:**
- `src/components/ui/tooltip.tsx` — zero imports in the entire codebase
- `src/components/ui/textarea.tsx` — duplicated by `@stigmer/react-ui`'s internal textarea

**Removed dead exports from `transport.ts`:**
- `Client` type re-export (consumers import from `@connectrpc/connect` directly)
- `createClient` re-export (same reason)

**Removed dead exports from `search-service.ts`:**
- `ApiResourceKind` re-export
- `SearchResponse` and `SearchResult` type re-exports
- `searchSkills()` function (zero callers)
- `searchMcpServers()` function (zero callers)

**Removed dead utility:**
- `formatDateTime()` from `src/lib/time.ts` (zero callers; `formatRelativeTime` is the active function)

**Fixed routing bug:**
- `src/app/page.tsx` dashboard card "Browse Catalog" linked to `/agents` — corrected to `/catalog`

**Intentionally preserved:**
- `OidcConfig` and `getIamApiAudience()` — future Auth0 integration stubs
- Chart CSS variables (`--color-chart-1` through 5) — reserved for visualization features
- Auth barrel re-exports — public API surface
- Shadcn component variants — standard component primitives

### T02: Prettier & ESLint Hardening

**Prettier setup:**
- Installed `prettier` and `prettier-plugin-tailwindcss`
- Created `.prettierrc` with standard rules (semicolons, double quotes, 80 char width, trailing commas)
- Created `.prettierignore` for build artifacts
- Added `format` and `format:check` npm scripts
- Applied formatting across the entire codebase

**ESLint hardening:**
- Added `@typescript-eslint/no-unused-vars: error` with `_`-prefix escape hatch
- Added `@typescript-eslint/no-explicit-any: error`
- Added `**/dist/**` to global ignores (compiled JS was triggering violations)

## Benefits

- **Reduced surface area**: 2 fewer files, 13 fewer exports to reason about
- **No more formatting debates**: Prettier enforces consistency automatically
- **Stricter type safety**: `no-explicit-any` prevents type erosion from the start
- **Catch dead code early**: `no-unused-vars` as error prevents future accumulation
- **Correct navigation**: Users clicking "Browse Catalog" now arrive at the catalog page
- **Clean baseline**: All three verification gates pass (`build`, `lint`, `format:check`)

## Impact

- **Developers**: Cleaner codebase to navigate; Prettier removes formatting decisions from code review
- **Users**: Dashboard routing bug fixed (previously landed on agents page instead of catalog)
- **Project**: Establishes the quality baseline that all 8 remaining phases build on

## Related Work

- Part of the [Web Architecture & UX Alignment](../../../_projects/2026-03/20260315.02.web-architecture-alignment/) project
- Preceded by [Web libs setup](../../../_projects/2026-03/20260315.01.web-libs-setup/) which created the `_libs/` package structure
- Next: Phase 2 — Package Rename (`@stigmer/react-ui` → `@stigmer/execution-ui`) + Visual Identity & Theme System

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
