# Fix Model Pricing Tests Using Unloaded Registry

**Date**: May 8, 2026

## Summary

Fixed 2 failing tests in the cursor-runner `model-pricing.test.ts` that were accessing the pricing registry before it was initialized. The tests now mock the API data layer and call `ensureLoaded()` before running assertions.

## Problem Statement

After the model registry was migrated from a static JSON file to an authenticated API fetch (`getPricingTable()`), the model-pricing unit tests broke because they called `getCursorModelPricing()` and `resolveModelId()` synchronously without first populating the in-memory pricing map.

### Pain Points

- `resolveModelId("composer-2")` returned `"default"` because the registry map was empty
- `getCursorModelPricing("claude-opus-4-7")` returned `DEFAULT_PRICING` (same rate as economy models), causing the tier-distinction assertion to fail
- `make check` failed with exit code 2 due to these 2 test failures

## Solution

Added a `vi.mock` for `model-pricing-data.js` that stubs `getPricingTable` with deterministic test pricing data, and a `beforeAll` hook that calls `ensureLoaded()` to populate the pricing map before any test runs.

## Implementation Details

- Used `vi.hoisted()` to define test pricing data in vitest's hoisted scope (required because `vi.mock` factories are hoisted above all other code)
- Test data includes realistic pricing tiers: economy, standard, and premium models with distinct rates
- `getPricingTable` is mocked to resolve with the static test table — no network dependency
- `ensureLoaded()` is called in `beforeAll` to populate the module-level `pricingByModel` map

## Benefits

- `make check` passes cleanly (202 tests pass, 5 integration tests skipped as expected)
- Tests are deterministic and network-independent
- Test pricing data documents the expected tier structure

## Impact

- **cursor-runner test suite**: Restored from 2 failures to fully passing
- **CI gate**: `make check` exits cleanly again

## Related Work

- `2026-05-08-155716-model-registry-api-migration.md` — the migration that introduced the async pricing fetch

---

**Status**: ✅ Production Ready
