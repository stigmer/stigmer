# Fix Codegen Pipeline: Stale @stigmer/protos Dist

**Date**: May 30, 2026

## Summary

Fixed two TypeScript build errors that blocked `make codegen` in the stigmer OSS repo. One was a stale type re-export (`SetupTabWorkspaceActions`), the other was a build-ordering gap where regenerated TS stubs weren't compiled to `dist/` before `typedoc` ran.

## Problem Statement

Running `make codegen` after proto changes (settlement scaffolding removal) failed during the `gen-react-sdk-docs` step with two TypeScript errors:

### Pain Points

- `SetupTabWorkspaceActions` was re-exported from barrel files but no longer existed in `SetupTab.tsx` — pre-existing broken export
- `isEstimated` field existed in regenerated TS stubs (source) but `@stigmer/protos` `dist/` was stale, so `typedoc` couldn't resolve the type
- `make codegen` had no step to rebuild `@stigmer/protos` between stub regeneration and SDK doc generation

## Solution

1. Removed stale `SetupTabWorkspaceActions` from both barrel files (`sdk/react/src/session/index.ts` and `sdk/react/src/index.ts`)
2. Added a `build-ts-stubs` Makefile target (`npm run build -w @stigmer/protos`) inserted into the `codegen` pipeline between `protos` and `gen-sdk-docs`

## Implementation Details

The `codegen` target previously ran: `protos → gen-sdk-docs → gen-narration`. The `protos` step regenerates TS stubs in `apis/stubs/ts/` (source files), but `@stigmer/protos` exports from `dist/` which requires a `tsc` build. Without rebuilding dist, any new proto fields (like `isEstimated`) are invisible to downstream TypeScript consumers.

New pipeline: `protos → build-ts-stubs → gen-sdk-docs → gen-narration`

## Benefits

- `make codegen` now works correctly after any proto change — no manual `npm run build -w @stigmer/protos` required
- Eliminates a class of "works on my machine" failures where dist happens to be fresh from a previous `make build`
- Fixes a pre-existing broken export that would have surfaced in any downstream consumer

## Impact

- **Developers**: `make codegen` is self-contained again — no hidden dependency on a prior `make build`
- **CI**: Codegen step won't fail spuriously after proto changes

## Related Work

- Part of the cursor billing reconciliation project (`20260529.01`)
- Proto changes that triggered this: removal of `UsageSettlementStatus`, `SettlementLink`, `PROVIDER_SETTLED` trust level

---

**Status**: ✅ Production Ready
