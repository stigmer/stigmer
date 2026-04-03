# Disable OpenAI and Ollama Providers in Model Selector

**Date**: April 3, 2026

## Summary

Added a `DISABLED_PROVIDERS` mechanism to the React SDK model registry that hides OpenAI and Ollama models from the UI while preserving all model data and backend compatibility. This replaces the need to delete or comment-out model entries, making re-enablement a one-line change.

## Problem Statement

The web app's model selector displayed OpenAI and Ollama models alongside Anthropic, but neither provider was operational — no OpenAI API key was configured and Ollama was not properly set up. Users could select these models and hit errors.

### Pain Points

- Users could choose non-functional providers from the dropdown
- OpenAI models appeared despite no API key being available
- Ollama models appeared despite the local inference stack not being configured

## Solution

Introduced a `DISABLED_PROVIDERS` set in the SDK's model registry that acts as a UI-level filter. The `useModelRegistry` hook skips any model whose provider appears in the set before building the grouped model list. No backend, type, or data changes were required.

## Implementation Details

- **`registry.ts`**: Added `DISABLED_PROVIDERS: ReadonlySet<Provider>` containing `"openai"` and `"ollama"`. The full `MODEL_REGISTRY` array is unchanged — all model entries remain for backend compatibility.
- **`useModelRegistry.ts`**: The hook's `useMemo` loop now checks `DISABLED_PROVIDERS.has(model.provider)` and skips matching models. The returned `models`, `byProvider`, and `providers` arrays only contain enabled providers.
- **`index.ts`**: Re-exported `DISABLED_PROVIDERS` so SDK consumers can inspect the current configuration.
- **No UI component changes**: `ModelSelector` already guards empty groups with `if (!models?.length) return null`, so disabled providers vanish from the dropdown automatically.

## Benefits

- Users only see providers that actually work (Anthropic)
- Zero risk of selecting a non-functional model
- Re-enabling a provider is a single-line edit (remove it from the set)
- All model metadata preserved — no data loss, no type changes

## Impact

- **SDK consumers**: The `useModelRegistry` hook now returns a filtered list; any custom UI built on it inherits the filtering automatically.
- **Site / demos**: The `SessionComposer` and any demo using `ModelSelector` will show only Anthropic models.
- **Backend**: Completely untouched — the `Provider` type union and `MODEL_REGISTRY` data remain intact.

## Related Work

- Model registry was ported from the Python backend source of truth (`model_registry.py`); that file is unaffected.
- A future backend RPC for dynamic model discovery (noted in `registry.ts` header comment) will eventually supersede this static approach.

---

**Status**: ✅ Production Ready
