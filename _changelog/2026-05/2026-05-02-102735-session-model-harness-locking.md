# Session Model Selection: Harness Locking and Execution-Based Default

**Date**: May 2, 2026

## Summary

Fixed the session page's follow-up composer to lock the model selector to the session's harness and auto-select the model from the most recent execution. Previously, a Cursor-harness session would show all models (including Stigmer/native models) and default to `claude-sonnet-4.5` instead of staying within the Cursor model catalog.

## Problem Statement

When a user created a session with the Cursor harness (e.g., using the "default" Cursor model), the follow-up message composer on the session page would auto-select "Claude Sonnet 4.5" — a Stigmer (native) harness model. This created two distinct issues:

### Pain Points

- The model selector showed all models from both harnesses, violating the session's harness contract
- The default model was wrong — falling back to the native harness default instead of the Cursor harness default
- Users could accidentally select a model from the wrong harness for follow-up messages
- The model from the previous execution was not carried forward as the default

## Solution

Two-layer fix that locks the model selector to the session's harness and derives the default model from the last execution.

**Layer 1 — Harness locking:** The session's harness (already correctly derived from `session.spec.harness` by `useSessionPageFlow`) is now passed through to the `ModelSelector` via `SessionComposer` and `ComposerToolbar`. A `harnessLocked` flag determines whether the selector operates in single-harness mode (session page) or unified mode (launcher).

**Layer 2 — Execution-based default:** When `usePersistedModel` returns no value (e.g., user never explicitly picked a model), the hook now falls back to the last completed execution's `spec.executionConfig.modelName`. Priority chain: persisted preference > last execution's model > harness default.

## Implementation Details

**`ComposerToolbar.tsx`** — Added `harnessLocked` derivation and conditional prop forwarding:

```tsx
const harnessLocked = harness !== undefined && !showHarnessSelector;

<ModelSelector
  harness={harnessLocked ? harness : undefined}
  onHarnessResolved={harnessLocked ? undefined : onHarnessChange}
/>
```

When `showHarnessSelector` is `true` (launcher), the selector stays in unified mode. When `false` with a `harness` value (session page), the catalog is locked.

**`SessionPage.tsx`** — One line: pass `harness={flow.harness}` to `SessionComposer`.

**`useSessionPageFlow.ts`** — Replaced direct `usePersistedModel` destructure with a fallback chain that reads the last execution's model from `spec.executionConfig.modelName`.

## Benefits

- Session page now only shows models compatible with the session's execution engine
- Follow-up messages default to the model actually used in the previous execution
- No risk of cross-harness model selection within an existing session
- Launcher behavior is unchanged — new sessions still show the full unified picker

## Impact

- **Users**: Follow-up model selection is now consistent with the session's harness. No more confusion from seeing Stigmer models in a Cursor session or vice versa.
- **Platform builders**: `useSessionPageFlow` now exposes a smarter model default via the existing `model` tuple. No API changes — the `UsePersistedModelReturn` contract is preserved.
- **Backend**: Zero changes. The model name was already stored in `ExecutionConfig.model_name`.

## Related Work

- [Unified Model Registry](2026-05-01-183214-unified-model-registry.md) — established the single `model-registry.json` catalog with harness-aware entries
- [Dynamic Cursor Model Discovery](2026-05-01-162936-dynamic-cursor-model-discovery.md) — populated the Cursor harness model entries

---

**Status**: ✅ Production Ready
