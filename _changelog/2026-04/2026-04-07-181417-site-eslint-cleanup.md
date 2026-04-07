# Site ESLint Cleanup — Demo Scenarios and Video Root

**Date**: April 7, 2026

## Summary

Fixed 6 ESLint errors across 4 files in the `site/` directory that were causing `make check` to fail. The errors were a mix of unused imports in demo scenario components and `no-explicit-any` violations in the Remotion video Root component.

## Problem Statement

`make check` was failing at the site lint step with 6 errors — 3 unused variable imports in demo tour scenarios and 3 explicit `any` type casts in the webpack `require.context` setup for Remotion video auto-discovery.

### Pain Points

- CI gate (`make check`) was blocked
- `any` types in `Root.tsx` hid potential type mismatches in the scenario auto-discovery pipeline

## Solution

Removed unused imports and replaced `any` casts with properly typed alternatives using a `RequireContext` interface and `Record<string, unknown>`.

## Implementation Details

**Unused imports removed:**
- `ApprovalAction` from `connect-tools-tour/index.tsx`
- `agentCreatedExecution` from `create-agent-tour/index.tsx`
- `skillCreatedExecution` from `first-skill-tour/index.tsx`

**Type safety improvements in `site/video/Root.tsx`:**
- Introduced `RequireContext` interface modeling webpack's `require.context` return shape
- Created `requireWithContext` typed helper to avoid repeated `as any` casts
- Replaced `as any` in `extractSteps` with `Record<string, unknown>` for safe property access

## Benefits

- `make check` lint step passes cleanly
- Webpack `require.context` calls are now type-safe — future misuse will surface at compile time
- No runtime behavior changes

## Impact

Site build and video export pipelines. No user-facing changes.

---

**Status**: ✅ Production Ready
