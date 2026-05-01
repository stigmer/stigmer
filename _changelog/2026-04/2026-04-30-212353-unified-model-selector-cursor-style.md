# Unified Model Selector (Cursor-Style)

**Date**: April 30, 2026

## Summary

Consolidated the separate HarnessSelector and ModelSelector controls into a single Cursor-style flat model picker with search. The Cursor model catalog was expanded from 3 models to 16, covering all Cursor API models from Anthropic, OpenAI, and Google. One control now replaces two, reducing toolbar clutter and cognitive load.

## Problem Statement

The session launcher had two separate controls for what is conceptually a single decision: a segmented pill for choosing the execution engine ("Stigmer" / "Cursor") and a dropdown for picking a model within that engine. This created clutter and forced users to make two sequential choices. Additionally, the Cursor catalog only showed 3 models (Auto, Composer 2, Composer 1.5) when Cursor provides access to 16+ premium models.

### Pain Points

- Two controls for one decision — engine selection and model selection were separate steps
- Cursor model catalog was incomplete — only 3 of 16 available models were exposed
- No search — users scrolled through grouped provider sections to find a model
- No curated defaults — the full list was shown every time, regardless of popularity

## Solution

Adopted Cursor's own model picker pattern: a single popover with a flat searchable list. Each model row carries a subtle engine tag ("Stigmer" or "Cursor") and cost-tier indicator. A curated default list of ~10 featured models keeps the initial view short; "Show All Models" expands to the full catalog; client-side search filters across all models instantly.

## Implementation Details

**9 files changed, +542 / -192 lines** in `@stigmer/react` (SDK package):

- **`registry.ts`**: Extended `ModelInfo` with `harness: HarnessOption` and `featured: boolean`. Expanded `Provider` type with `"google"` and `"xai"`. Removed `"cursor"` from `DISABLED_PROVIDERS`. Added 16 Cursor-harness model entries with IDs matching `cursor-runner/model-pricing.ts`. Added `modelKey()` / `parseModelKey()` for compound key management.

- **`useModelRegistry.ts`**: Added unified mode (no `harness` argument) that returns models from both engines. New fields: `featured` (curated subset) and `getByKey` (compound key lookup). Single-harness modes preserved for backward compatibility.

- **`ModelSelector.tsx`**: Rewrote from `@base-ui/react` Select to a Popover-based flat picker. Features: search input, curated default list, "Show All Models" expansion, engine tag badges, cost-tier indicators, checkmark on selected model, keyboard navigation (ArrowUp/Down, Enter, Escape), ARIA roles (`dialog`, `searchbox`, `listbox`, `option`).

- **`ComposerToolbar.tsx`**: When `showModelSelector` is true, `HarnessSelector` is suppressed. The unified `ModelSelector` receives `onHarnessResolved` wired to the toolbar's `onHarnessChange`.

- **`SessionComposer.tsx`**: Removed harness-switch model reset effect (now internal to ModelSelector). Added compound key resolution in submit handler.

- **`HarnessSelector.tsx`**: Marked as `@deprecated` with migration guidance. Export preserved for backward compatibility.

- **Tests**: `useModelRegistry.test.tsx` rewritten with 24 tests for unified/native/cursor modes, featured filtering, and compound key lookup. All 228 tests pass across 21 test files.

## Benefits

- **One control replaces two** — toolbar goes from `[Stigmer][Cursor] [model v]` to just `[model v]`
- **16 Cursor models** available instead of 3 — users can pick Claude, GPT, Gemini, and Cursor-native models
- **Search across full catalog** — power users find any model instantly
- **Curated defaults** — 10 featured models keep the initial view fast and focused (Hick's Law)
- **Familiar pattern** — directly mirrors Cursor's own model picker (Jakob's Law)
- **Zero breaking changes** — all exports are additive, deprecated component still works

## Impact

- **SDK consumers**: `ModelSelector` gains new `onHarnessResolved` prop for unified mode; existing usage with `harness` prop continues to work
- **End users**: Simpler, more powerful model selection with access to the full Cursor model catalog
- **Platform builders**: `useModelRegistry()` without arguments now returns a unified view; `featured` and `getByKey` enable custom picker implementations

## Related Work

- [Wire Harness Selector into Desktop and Web](2026-04-30-201350-wire-harness-selector-desktop-web.md) — the previous HarnessSelector implementation that this work supersedes
- [Fix Cursor Runner Cloud Availability](2026-04-30-201753-fix-cursor-runner-cloud-availability.md) — cloud runner fix enabling the Cursor harness to work in production
- Plan document: `.cursor/plans/unified_model_selector_72ce7042.plan.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
