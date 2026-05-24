# Fix LLM Call Model Registry Resolution

**Date**: May 25, 2026

## Summary

Added model ID resolution to the `call-llm` Temporal activity so that Stigmer registry IDs (e.g., `claude-haiku-4.5`) are translated to provider API model IDs (e.g., `claude-haiku-4-5-20251001`) before being sent to the LLM provider. This closes a gap where the proto documentation promised "Model reference resolved via the Stigmer model registry" but the implementation passed model strings through unchanged.

## Problem Statement

Workflow `llm_call` tasks that used Stigmer canonical model IDs (dot-notation like `claude-haiku-4.5`) failed at runtime with `LLM_PERMISSION_DENIED` (Anthropic returns 404 for unrecognized model names, which the proxy surfaces as 403).

### Pain Points

- Users followed the documented convention of writing Stigmer registry IDs in workflow YAML
- The system failed only at execution time with a confusing "permission denied" error
- The `agent_call` path (via Cursor SDK) resolved models correctly, but `llm_call` did not — inconsistent behavior between task types
- The model registry already maintained both `id` and `apiModelId` but the `call-llm` activity never used the mapping

## Solution

Extended `model-registry.ts` to parse `apiModelId` from the registry JSON and added a `resolveToApiModelId()` function. Wired this into `callLlmAction()` so the resolution happens before provider inference and API calls.

## Implementation Details

**`backend/services/runner/src/shared/model-registry.ts`**:
- Added `apiModelId?: string` to the `RegistryModel` interface
- Included `apiModelId` parsing in `parseRegistry()`
- Added `resolveToApiModelId(registryId)` — looks up the model by `id`, returns `apiModelId` if found, falls back to original string if registry unavailable or model not found

**`backend/services/runner/src/activities/call-llm.ts`**:
- Imported `resolveToApiModelId` from the shared registry module
- Added resolution call before `inferProvider()` in `callLlmAction()`
- Fixed cost computation to use original registry ID (pricing is indexed by `id`, not `apiModelId`)

**`backend/services/runner/src/activities/__tests__/call-llm.test.ts`**:
- Added `_resetRegistryCache()` to `beforeEach` to prevent cross-test cache interference
- Added `mockFetchWithRegistry()` helper that routes model-registry fetches to an empty response while passing LLM calls to test-specified mocks

## Benefits

- Workflow YAML can now use Stigmer's canonical model IDs (the documented convention)
- Consistent behavior between `llm_call` and `agent_call` task types
- Graceful degradation: if registry is unavailable, the original string is passed through unchanged (no regression for models whose registry ID happens to match the provider ID)
- Cost attribution remains accurate (uses registry ID for pricing lookup)

## Impact

- All workflow `llm_call` tasks using Stigmer registry model IDs will now work correctly
- No breaking changes — models that already used provider-accepted names continue to work
- The `daily-notification-plan` workflow in the TT Demo project can now be recovered and will succeed

## Related Work

- Model registry architecture (`stigmer-cloud/.cursor/rules/update-model-registry.mdc`)
- Existing `resolveModelId()` in `execute-cursor/model-pricing.ts` (pricing validation, not API ID resolution)
- `isModelRegistered()` in `shared/model-registry.ts` (sub-agent model override validation)

---

**Status**: ✅ Production Ready
