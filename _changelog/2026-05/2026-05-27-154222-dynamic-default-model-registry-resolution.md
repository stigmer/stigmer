# Dynamic Default Model Resolution via Registry

**Date**: May 27, 2026

## Summary

Replaced the hardcoded default model in the deep agent execution pipeline with dynamic resolution from the model registry. When a user hasn't selected a model, the runner now queries the cloud registry for the platform's featured standard-tier native model instead of relying on a static string that goes stale when providers deprecate models.

## Problem Statement

The deep agent execution path in `setup.ts` hardcoded `"claude-sonnet-4-20250514"` as the fallback model. When Anthropic deprecated this model (hard retirement June 15, 2026), sub-agent executions crashed with unhandled rejections from deepagents. The platform already solved this on the Java side (`ModelPricingService.findCheapestNativeModel()`) and for economy tasks on the runner side (`getEconomyModel()`), but the primary agent execution model remained a static string.

### Pain Points

- Hardcoded model strings go stale when providers deprecate models
- Sub-agent delegation crashed because the deprecated model caused `"Subagent researcher failed"` errors inside deepagents
- The runner's `model-registry.ts` already had the infrastructure for dynamic resolution but lacked a function for the primary execution model tier

## Solution

Added `getDefaultModel()` to the runner's model registry module, following the same pattern as the existing `getEconomyModel()`. The function queries the cloud registry for the first `featured + standard + native` model and returns its `apiModelId` for direct use by the LLM client.

## Implementation Details

- Extended `RegistryModel` interface with `featured: boolean`, parsed from the registry JSON
- Added `getDefaultModel()` with three-tier resolution: featured+standard+native → any standard+native → hardcoded fallback
- Returns `apiModelId` (e.g., `"claude-sonnet-4-6"`) not the Stigmer registry ID (e.g., `"claude-sonnet-4.6"`)
- Updated `setup.ts` to call `await getDefaultModel()` instead of hardcoding
- Added 7 unit tests covering all resolution tiers, cursor-harness exclusion, registry failures, and ordering semantics

## Benefits

- Default model automatically tracks the platform's curated recommendation via the registry
- No code changes needed when Anthropic or OpenAI deprecate/retire models — just update the registry JSON and redeploy the cloud service
- Follows established pattern (`getEconomyModel`), consistent codebase
- Hardcoded fallback (`"claude-sonnet-4-6"`) only activates when the registry API is unreachable — rare in production

## Impact

- All new agent executions that don't specify a model will use the registry-resolved default
- Sub-agent model inheritance continues to work (inherits parent's resolved model)
- Zero impact on Cursor harness, workflow `call:llm`, or economy-tier resolution paths

---

**Status**: Production Ready
