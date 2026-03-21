# Fix TypeScript Build Errors and Improve CI Check Gate

**Date**: March 21, 2026

## Summary

Resolved TypeScript compilation errors across `@stigmer/sdk` and `@stigmer/react` test files that were breaking the `make check` CI gate. Also added the missing `libs-build` target to the Makefile so `make check` now covers the full CI pipeline including SDK/lib package builds.

## Problem Statement

Running `make check` failed at the `libs-build` step with 8 TypeScript compilation errors across three SDK packages, preventing the local CI gate from passing.

### Pain Points

- `@stigmer/sdk` had 4 type errors in test files: a dead-code type cast, a reference to non-existent `Code.OK` enum value, and two unsafe `Transport`-to-`Record` casts
- `@stigmer/react` had 4 type errors where the `makeUsage` test helper was missing the `modelBreakdown` and `llmCalls` array fields from the `UsageMetrics` proto
- The `Makefile` `check` target was missing the `libs-build` step, so SDK package builds were not validated locally

## Solution

Fixed all 8 TypeScript errors in their respective test files and verified the full `make check` pipeline passes end-to-end.

## Implementation Details

### sdk/typescript test fixes

- **`src/__tests__/errors.test.ts`**: Removed dead code that constructed an unused `StigmerError` with a broken type cast. Used proper `ErrorCode` type import for the cast that's actually used.
- **`src/__tests__/gen/errors.test.ts`**: `Code.OK` doesn't exist in `@connectrpc/connect` (the `Code` enum starts at `Canceled = 1`). Replaced with `0 as unknown as Code` to test the unmapped-code branch.
- **`src/__tests__/gen/session-client.test.ts`**: `Transport` interface lacks an index signature, so direct cast to `Record<string, unknown>` fails. Added intermediate `unknown` cast: `transport as unknown as Record<string, unknown>`.

### sdk/react test fix

- **`src/execution/__tests__/useExecutionUsage.test.tsx`**: The `makeUsage` helper's `Partial` type only listed scalar fields from `UsageMetrics`. Added `modelBreakdown` and `llmCalls` (repeated/array fields from the proto) to the type definition.

### Makefile improvements

- Added `libs-build` target that runs `npm run build:libs` and `npm test`
- Added `libs-build` to the `check` target for full CI parity: `protos tidy lint libs-build web-build build test`

## Benefits

- `make check` now passes cleanly and covers the same steps as CI
- SDK package build errors are caught locally before pushing
- All 8 TypeScript errors resolved with minimal, targeted fixes

## Impact

- Developers running `make check` locally now get full CI coverage
- No functional changes — all fixes are in test files and build configuration

---

**Status**: ✅ Production Ready
