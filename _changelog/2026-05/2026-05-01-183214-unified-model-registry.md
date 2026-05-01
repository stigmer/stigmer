# Unified Model Registry — Single Source of Truth

**Date**: May 1, 2026

## Summary

Consolidated all model metadata — IDs, display names, providers, pricing, cost tiers, context windows, capabilities, summarization thresholds, and token counter methods — into a single JSON registry at `backend/libs/model-registry.json`. Three consumers (cursor-runner TypeScript, React SDK, Python agent-runner) read from this one file via thin wrappers, eliminating three separate hardcoded registries that were manually kept in sync.

## Problem Statement

Model metadata was scattered across three separate files with different naming conventions and no shared contract:

- `model_registry.py` (Python) — native harness models with full runtime config + pricing
- `model-pricing-data.ts` (TypeScript) — Cursor harness models with pricing
- `registry.ts` (React SDK) — both harnesses with display names, cost tiers, and model IDs

### Pain Points

- Model ID mismatches between the UI and backend (e.g., `claude-4.7-opus` vs `claude-opus-4-7`) caused the runner to silently fall back to "default" for many models
- Adding a new model required updating three files in two languages
- Pricing drift between the UI's cost tier labels and the backend's actual rates
- No single source of truth — each file was independently maintained
- Runtime model discovery via `Cursor.models.list()` added async complexity and failure modes

## Solution

A single `model-registry.json` file containing every model across both harnesses. Three thin wrappers import it:

1. **cursor-runner** (`model-pricing-data.ts`) — filters `harness: "cursor"`, exports `PRICING_TABLE`
2. **React SDK** (`registry.ts`) — maps all entries to `MODEL_REGISTRY` for the UI picker
3. **Python graphton** (`model_registry.py`) — builds `ModelMetadata` objects from `harness: "native"` entries

An AI Cursor rule (`@update-model-registry`) fetches live data from Cursor's pricing page and model catalog, cross-references them, and writes the JSON file.

## Implementation Details

- **Eliminated `model-discovery.ts`** — runtime `Cursor.models.list()` API calls replaced by a synchronous `resolveModelId()` map lookup against `PRICING_TABLE`
- **Eliminated codegen script** — `scripts/update-pricing.ts`, its tests, the `make update-pricing` Makefile target, and the `cheerio` dependency were all removed
- **Fixed model ID contract** — Cursor harness models use proxy canonical IDs (`claude-opus-4-7`), native models use platform IDs (`claude-opus-4.6`) with `apiModelId` for the provider API
- **Fixed `DEFAULT_CURSOR_MODEL_ID`** — changed from `"auto"` to `"default"` (matching the Cursor API)
- **Python pure loader** — `model_registry.py` has zero hardcoded model data; `_ensure_loaded()` reads everything from JSON

## Benefits

- **One file to update** when adding, removing, or repricing models
- **Zero ID mismatches** — the JSON is the contract between UI and all backends
- **Simpler runtime** — no async model discovery, no caching, no API call failures
- **AI-maintainable** — `@update-model-registry` handles the full refresh pipeline

## Impact

- **cursor-runner**: Simplified from ~1200 lines of codegen + discovery to ~120 lines of thin wrappers
- **React SDK**: Model picker now shows correct IDs aligned with both runners
- **Python agent-runner**: Pricing loaded from shared JSON, runtime config (context windows, capabilities) also in JSON
- **Developer workflow**: Adding a model = one JSON entry; all consumers pick it up

## Related Work

- [Dynamic Cursor Model Discovery](2026-05-01-162936-dynamic-cursor-model-discovery.md) — the intermediate step that this unification supersedes
- [Automated Cursor Pricing Codegen Pipeline](2026-05-01-170717-automated-cursor-pricing-codegen-pipeline.md) — the script-based approach that was replaced by the AI rule

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (architecture design + implementation across 3 runtimes)
